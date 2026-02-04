/**
 * AI Web SDK - API 适配器示例
 * 用户需要根据实际后端实现自己的 request 方法，并调用 sdk.setApiAdapter(adapter)
 *
 * 适配器需实现：request({ messages, methodName, config }) => Promise<string>
 */

(function (global) {
  'use strict';

  /**
   * 示例：调用 OpenAI 兼容接口（或自建代理）
   * @param {Object} options 可选配置，如 apiUrl、apiKey
   */
  function createOpenAIAdapter(options) {
    options = options || {};
    var apiUrl = options.apiUrl || 'https://api.openai.com/v1/chat/completions';
    var apiKey = options.apiKey || '';

    return {
      request: function (params) {
        var messages = params.messages || [];
        var methodName = params.methodName;
        var config = params.config || {};
        // 可针对不同 methodName 或 config 做不同处理
        var body = {
          model: options.model || 'gpt-3.5-turbo',
          messages: messages.map(function (m) { return { role: m.role, content: m.content }; })
        };
        return fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify(body)
        })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            var content = data.choices && data.choices[0] && data.choices[0].message
              ? data.choices[0].message.content
              : (data.error && data.error.message) || '请求失败';
            return content;
          });
      }
    };
  }

  /**
   * 本地 LLM 聊天接口适配器
   * 请求体：{ messages, maxTokens, temperature }
   * @param {Object} options 可选：apiUrl, maxTokens, temperature
   */
  function createLocalChatAdapter(options) {
    options = options || {};
    var apiUrl = options.apiUrl || 'http://localhost:8080/aiProject/api/llm/chat';
    var maxTokens = options.maxTokens !== undefined ? options.maxTokens : 2048;
    var temperature = options.temperature !== undefined ? options.temperature : 0.7;

    return {
      request: function (params) {
        var messages = params.messages || [];
        var body = {
          messages: messages.map(function (m) { return { role: m.role, content: m.content }; }),
          maxTokens: maxTokens,
          temperature: temperature
        };
        return fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
          .then(function (res) {
            if (!res.ok) {
              throw new Error('请求失败: ' + res.status + ' ' + res.statusText);
            }
            return res.json();
          })
          .then(function (data) {
            // 根据实际后端返回结构调整：常见为 content / data.content / choices[0].message.content
            var content = data.content != null
              ? data.content
              : (data.data && data.data.content != null)
                ? data.data.content
                : (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content != null)
                  ? data.choices[0].message.content
                  : (data.message != null) ? data.message : (data.msg != null) ? data.msg : '';
            if (content === '' && data.error) content = data.error.message || data.error;
            return content !== '' ? content : '接口未返回内容';
          });
      }
    };
  }

  /**
   * 示例：纯本地模拟，用于开发/演示，不请求真实接口
   */
  function createMockAdapter() {
    return {
      request: function (params) {
        var messages = params.messages || [];
        var lastUser = messages[messages.length - 1];
        var userText = lastUser && lastUser.role === 'user' ? lastUser.content : '';
        return Promise.resolve('[Mock] 收到内容: ' + userText + '。这里是模拟的 AI 回复。');
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createOpenAIAdapter: createOpenAIAdapter,
      createLocalChatAdapter: createLocalChatAdapter,
      createMockAdapter: createMockAdapter
    };
  } else {
    global.AIWebSDKAdapters = {
      createOpenAIAdapter: createOpenAIAdapter,
      createLocalChatAdapter: createLocalChatAdapter,
      createMockAdapter: createMockAdapter
    };
  }
})(typeof window !== 'undefined' ? window : this);
