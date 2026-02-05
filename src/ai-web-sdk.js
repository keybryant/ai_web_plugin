/**
 * AI Web SDK - 帮助网站快速接入 AI 功能的插件
 *
 * 功能：
 * - 用户自己传入 prompt 内容，收到 AI 返回后自行处理显示
 * - 可指定方法作为 prompt 处理层（可选）
 * - 可指定回调方法接收返回内容，在回调里自行决定在哪里显示
 * - 为每个方法建立上下文数组，支持上下文开关（1 使用 / 0 不使用）
 * - 通过配置注册方法，前端通过 sdk.methodName(prompt) 或 sdk.methodName({ prompt, callback }) 触发
 * - 表单助手：用标签区分表单和字段，根据描述与填写内容拼接成 prompt，调用 SDK 后将结果输出到指定元素
 */

var aiWebSdkFactory = function (global, factory) {
  var sdk = factory(global);
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = sdk;
  } else if (typeof define === 'function' && define.amd) {
    define([], function () { return sdk; });
  } else {
    global.AIWebSDK = sdk;
  }
  return sdk;
};

var aiWebSdk = aiWebSdkFactory(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';

  // 存储每个方法的上下文：key 为方法名，value 为消息数组 [{ role, content }]
  var contextStore = {};
  // 默认是否使用上下文的开关：1 使用，0 不使用
  var defaultUseContext = 1;
  // 注册的方法配置表：methodName -> config
  var methodConfigs = {};
  // AI 请求适配器（由用户注入）
  var apiAdapter = null;

  /**
   * 对 prompt 应用处理层（若配置了 promptProcessor）
   * @param {string} rawContent 用户传入的 prompt 内容
   * @param {Object} config 方法配置
   * @param {string} methodName 方法名
   * @returns {string}
   */
  function processPrompt(rawContent, config, methodName) {
    var processor = config.promptProcessor;
    if (typeof processor === 'function') {
      return processor(rawContent, methodName, config) || rawContent;
    }
    return rawContent;
  }

  /**
   * 根据配置构建完整的 systemPrompt（用户 systemPrompt + 返回格式 + 格式样例 + 函数列表）
   * @param {Object} merged 合并后的配置（register 配置 + 本次调用选项）
   * @returns {string} 拼接后的系统提示，无内容时返回空字符串
   */
  function buildSystemPrompt(merged) {
    var parts = [];
    var systemPrompt = merged.systemPrompt;
    if (systemPrompt != null && String(systemPrompt).trim()) {
      parts.push(String(systemPrompt).trim());
    }
    var responseFormat = merged.responseFormat;
    if (responseFormat != null && String(responseFormat).trim()) {
      parts.push('请严格按照以下格式返回：' + String(responseFormat).trim());
    }
    var responseFormatExample = merged.responseFormatExample;
    if (responseFormatExample != null && String(responseFormatExample).trim()) {
      parts.push('返回格式样例：\n' + String(responseFormatExample).trim());
    }
    var functions = merged.functions;
    if (functions != null && typeof functions === 'object') {
      var list = Array.isArray(functions) ? functions : [];
      if (!Array.isArray(functions)) {
        for (var key in functions) {
          if (functions.hasOwnProperty(key)) {
            var fn = functions[key];
            var name = (fn && fn.name != null) ? String(fn.name) : key;
            var desc = (fn && fn.description != null) ? String(fn.description) : '';
            list.push({ name: name, description: desc });
          }
        }
      }
      if (list.length > 0) {
        parts.push('可用函数列表（name 为方法名，description 为描述）：');
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          var n = (item && item.name != null) ? String(item.name) : '';
          var d = (item && item.description != null) ? String(item.description) : '';
          parts.push('- name: ' + n + ', description: ' + d);
        }
      }
    }
    return parts.join('\n\n');
  }

  /**
   * 获取当前方法的上下文消息列表（仅当 useContext === 1 时）
   */
  function getContextMessages(methodName, useContext) {
    if (useContext !== 1) return [];
    if (!contextStore[methodName]) contextStore[methodName] = [];
    return contextStore[methodName].slice();
  }

  /**
   * 追加一条消息到上下文
   */
  function appendToContext(methodName, role, content) {
    if (!contextStore[methodName]) contextStore[methodName] = [];
    contextStore[methodName].push({ role: role, content: content });
  }

  /**
   * 若配置或本次调用提供了 callback，则执行
   */
  function deliverResult(content, merged, methodName) {
    var cb = merged.callback;
    if (typeof cb === 'function') {
      cb(content, methodName, merged);
    }
  }

  /**
   * 执行一次 AI 调用
   * @param {string} methodName 注册的方法名
   * @param {string|Object} promptOrOptions 用户传入的 prompt 字符串，或 { prompt, callback?, useContext?, systemPrompt?, responseFormat?, responseFormatExample?, functions? } 等
   * @returns {Promise<string>} 返回 AI 回复内容
   */
  function runMethod(methodName, promptOrOptions) {
    var config = methodConfigs[methodName];
    if (!config) {
      return Promise.reject(new Error('AIWebSDK: 未找到方法 "' + methodName + '" 的配置，请先 register 注册。'));
    }
    var rawPrompt = '';
    var callOptions = {};
    if (typeof promptOrOptions === 'string') {
      rawPrompt = promptOrOptions;
    } else if (promptOrOptions && typeof promptOrOptions === 'object') {
      callOptions = promptOrOptions;
      rawPrompt = callOptions.prompt != null ? String(callOptions.prompt) : '';
    }
    var merged = Object.assign({}, config, callOptions);
    var useContext = merged.useContext !== undefined ? merged.useContext : defaultUseContext;
    var processedPrompt = processPrompt(rawPrompt, merged, methodName);
    var contextMessages = getContextMessages(methodName, useContext);
    var messages = [];
    // 若指定了 systemPrompt / 返回格式 / 格式样例 / 函数列表，拼成系统提示并放在最前面，每次请求都会带上
    var systemContent = buildSystemPrompt(merged);
    if (systemContent) {
      messages.push({ role: 'system', content: systemContent });
    }
    for (var i = 0; i < contextMessages.length; i++) {
      messages.push(contextMessages[i]);
    }
    messages.push({ role: 'user', content: processedPrompt });
    if (!apiAdapter || typeof apiAdapter.request !== 'function') {
      return Promise.reject(new Error('AIWebSDK: 未设置 apiAdapter，请先 setApiAdapter。'));
    }
    return apiAdapter.request({ messages: messages, methodName: methodName, config: merged })
      .then(function (responseContent) {
        if (useContext === 1) {
          appendToContext(methodName, 'user', processedPrompt);
          appendToContext(methodName, 'assistant', responseContent);
        }
        deliverResult(responseContent, merged, methodName);
        return responseContent;
      });
  }

  /**
   * 注册一个方法
   * @param {string} methodName 方法名，将挂载到 sdk[methodName]
   * @param {Object} config 配置项
   * @param {Function} [config.promptProcessor] 可选，处理 prompt 的方法 (rawContent, methodName, config) => string
   * @param {Function} [config.callback] 可选，返回内容的回调 (content, methodName, config) => void，也可在调用时传入
   * @param {number} [config.useContext=1] 1 使用上下文，0 不使用
   * @param {string} [config.systemPrompt] 可选，系统提示，每次请求都会放在消息最前面
   * @param {string} [config.responseFormat] 可选，要求返回的格式（如 "json"），会拼入 systemPrompt
   * @param {string} [config.responseFormatExample] 可选，返回格式的样例，会拼入 systemPrompt
   * @param {Object|Array} [config.functions] 可选，函数列表，格式为 { name: { name, description } } 或 [{ name, description }]，会拼入 systemPrompt
   */
  function register(methodName, config) {
    if (!methodName || typeof methodName !== 'string') {
      throw new Error('AIWebSDK: register 需要有效的 methodName');
    }
    methodConfigs[methodName] = Object.assign({ useContext: defaultUseContext }, config || {});
    contextStore[methodName] = contextStore[methodName] || [];
    if (!sdk[methodName]) {
      sdk[methodName] = function (promptOrOptions) { return runMethod(methodName, promptOrOptions); };
    }
    return sdk;
  }

  function setDefaultUseContext(value) {
    defaultUseContext = value === 0 ? 0 : 1;
    return sdk;
  }

  function setApiAdapter(adapter) {
    apiAdapter = adapter;
    return sdk;
  }

  function getContext(methodName) {
    if (methodName) return (contextStore[methodName] || []).slice();
    var copy = {};
    for (var k in contextStore) { if (contextStore.hasOwnProperty(k)) copy[k] = contextStore[k].slice(); }
    return copy;
  }

  function clearContext(methodName) {
    if (methodName) {
      contextStore[methodName] = [];
    } else {
      for (var k in contextStore) { if (contextStore.hasOwnProperty(k)) contextStore[k] = []; }
    }
    return sdk;
  }

  // ---------- 表单助手 ----------
  // 表单容器：data-ai-form="表单标签"  data-ai-form-desc="表单描述"
  // 字段：data-ai-field="字段标签"    data-ai-field-desc="字段描述"（input/select/textarea 取 value，其它取 textContent）

  var FORM_ASSISTANT_METHOD = 'formAssistant';

  /**
   * 根据表单标签获取表单数据（描述 + 字段列表）
   * @param {string} formTag 表单标签，对应 DOM 上 data-ai-form="formTag"
   * @returns {{ formDesc: string, fields: Array<{ tag: string, desc: string, value: string }> }|null}
   */
  function getFormData(formTag) {
    var doc = global.document;
    if (!doc) return null;
    var formEl = doc.querySelector('[data-ai-form="' + formTag + '"]');
    if (!formEl) return null;
    var formDesc = (formEl.getAttribute('data-ai-form-desc') || '').trim();
    var fieldEls = formEl.querySelectorAll('[data-ai-field]');
    var fields = [];
    for (var i = 0; i < fieldEls.length; i++) {
      var el = fieldEls[i];
      var tag = (el.getAttribute('data-ai-field') || '').trim();
      var desc = (el.getAttribute('data-ai-field-desc') || '').trim();
      var value = '';
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        value = (el.value != null ? el.value : '').toString().trim();
      } else {
        value = (el.textContent != null ? el.textContent : '').toString().trim();
      }
      fields.push({ tag: tag, desc: desc, value: value });
    }
    return { formDesc: formDesc, fields: fields };
  }

  /**
   * 将表单数据与用户拼接要求拼成 prompt；若指定了需补充的字段，会在 prompt 中明确告知 AI
   * @param {Object} formData getFormData 的返回值
   * @param {string} [promptInstruction] 用户要求的拼接/处理描述
   * @param {string[]} [supplementFieldTags] 需要 AI 补充的字段标签（data-ai-field 值）
   * @param {string} [supplementFieldLabel] 需补充字段的展示文案（如「备注(remark)」），当输出元素在表单外时由输出元素的 data-ai-field-desc 得到
   * @returns {string}
   */
  function buildFormPrompt(formData, promptInstruction, supplementFieldTags, supplementFieldLabel) {
    var parts = [];
    if (formData.formDesc) {
      parts.push('表单描述：' + formData.formDesc);
    }
    if (formData.fields && formData.fields.length > 0) {
      parts.push('字段信息：');
      for (var i = 0; i < formData.fields.length; i++) {
        var f = formData.fields[i];
        var line = '- ' + (f.desc ? f.desc + '(' + f.tag + ')' : f.tag) + '：' + f.value;
        parts.push(line);
      }
    }
    if (supplementFieldLabel && supplementFieldLabel.trim()) {
      parts.push('需要AI补充的字段：' + supplementFieldLabel.trim());
    } else if (supplementFieldTags && supplementFieldTags.length > 0) {
      var labels = [];
      var tagSet = {};
      for (var t = 0; t < supplementFieldTags.length; t++) {
        tagSet[supplementFieldTags[t]] = true;
      }
      for (var j = 0; j < formData.fields.length; j++) {
        var field = formData.fields[j];
        if (tagSet[field.tag]) {
          labels.push(field.desc ? field.desc + '(' + field.tag + ')' : field.tag);
        }
      }
      if (labels.length > 0) {
        parts.push('需要AI补充的字段：' + labels.join('、'));
      }
    }
    parts.push('请帮助用户完成需要补充的字段。请直接把该字段的内容返回，不需要返回思考过程以及理由等其他内容。');
    if (promptInstruction && promptInstruction.trim()) {
      parts.push('用户要求：' + promptInstruction.trim());
    }
    return parts.join('\n\n');
  }

  /**
   * 表单助手：根据表单标签收集内容拼成 prompt，调用已注册的 formAssistant 方法，将返回写入指定元素
   * 输出元素即“需要 AI 补充的字段”：若该元素带有 data-ai-field（及 data-ai-field-desc），会在 prompt 中告知 AI 要补充的是该字段
   * @param {string} formTag 表单标签（DOM 上 data-ai-form="formTag"）
   * @param {Object} options
   * @param {string} options.outputElementId 输出内容的元素 id；该元素若带 data-ai-field，即表示要 AI 补充的字段
   * @param {string} [options.promptInstruction] 需要拼接的要求描述（如「请根据上述信息生成备注」）
   * @param {number} [options.useContext] 本次是否使用上下文，0 或 1
   * @returns {Promise<string>}
   */
  function runFormAssistant(formTag, options) {
    options = options || {};
    var outputElementId = options.outputElementId;
    var promptInstruction = options.promptInstruction;
    if (!outputElementId) {
      return Promise.reject(new Error('AIWebSDK.runFormAssistant: 缺少 outputElementId'));
    }
    var doc = global.document;
    var outputEl = doc ? doc.getElementById(outputElementId) : null;
    var supplementFieldTags = [];
    var supplementFieldLabel = '';
    if (outputEl && outputEl.getAttribute && outputEl.getAttribute('data-ai-field')) {
      var tag = (outputEl.getAttribute('data-ai-field') || '').trim();
      var desc = (outputEl.getAttribute('data-ai-field-desc') || '').trim();
      if (tag) {
        supplementFieldTags = [tag];
        supplementFieldLabel = desc ? desc + '(' + tag + ')' : tag;
      }
    }
    var formData = getFormData(formTag);
    if (!formData) {
      return Promise.reject(new Error('AIWebSDK.runFormAssistant: 未找到表单标签 "' + formTag + '"'));
    }
    var prompt = buildFormPrompt(formData, promptInstruction, supplementFieldTags, supplementFieldLabel);
    if (outputEl) {
      outputEl.textContent = '请求中...';
    }
    if (!methodConfigs[FORM_ASSISTANT_METHOD]) {
      register(FORM_ASSISTANT_METHOD, { useContext: 0 });
    }
    var callback = function (content) {
      if (outputEl) outputEl.textContent = content;
    };
    return runMethod(FORM_ASSISTANT_METHOD, {
      prompt: prompt,
      callback: callback,
      useContext: options.useContext
    }).catch(function (err) {
      if (outputEl) outputEl.textContent = '请求失败: ' + (err && err.message ? err.message : err);
      throw err;
    });
  }

  var sdk = {
    register: register,
    setApiAdapter: setApiAdapter,
    setDefaultUseContext: setDefaultUseContext,
    getContext: getContext,
    clearContext: clearContext,
    runFormAssistant: runFormAssistant,
    getFormData: getFormData,
    buildFormPrompt: buildFormPrompt
  };

  return sdk;
});

// 通过 script 引入时挂到 global.AIWebSDK；Vite/ESM 可通过 window.AIWebSDK 或 module.exports 使用
