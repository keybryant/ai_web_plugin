# AI Web Plugin - 快速帮助网站接入 AI 功能

通过配置注册方法，用户**自己传入 prompt 内容**，**在回调里自行处理返回内容的显示**。

## 功能概览

- **Prompt**：调用时直接传入内容，如 `sdk.searchGoods('帮我搜索手机')` 或 `sdk.searchGoods({ prompt: '...', callback })`
- **Prompt 处理层**：可选，在注册时配置 `promptProcessor` 对传入内容做加工
- **返回内容**：通过 **callback** 或 **Promise** 拿到返回内容，由用户自己决定显示到哪里
- **上下文**：为每个方法维护对话上下文；支持 `useContext`：`1` 使用、`0` 不使用
- **配置注册**：`sdk.register('methodName', config)` 注册后，用 `sdk.methodName(prompt)` 或 `sdk.methodName({ prompt, callback })` 触发
- **表单助手**：用标签区分表单和字段（带描述），按钮触发时传入表单标签、输出元素 id、拼接要求，SDK 自动拼成 prompt 调用 AI 并将结果写入指定元素

## 快速开始

1. 引入 SDK 并设置适配器：

```javascript
import sdk from '@/lib/ai-web-sdk.js'
sdk.setApiAdapter(yourAdapter)  // adapter.request({ messages }) 返回 Promise<string>
```

2. 注册方法（可选：promptProcessor、callback、useContext）：

```javascript
sdk.register('searchGoods', {
  promptProcessor: function (raw, name, config) {
    return '【商品搜索】' + raw
  },
  useContext: 1
})
```

3. 调用时传入 prompt，在回调里处理显示：

```javascript
// 方式一：直接传 prompt 字符串
sdk.searchGoods('帮我搜索手机').then(content => {
  document.getElementById('result').textContent = content
})

// 方式二：传对象，内含 prompt 和本次 callback
sdk.searchGoods({
  prompt: document.getElementById('input').value,
  callback: (content) => {
    document.getElementById('result').textContent = content
  }
})
```

## 配置项说明（register）

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `promptProcessor` | `function(rawContent, methodName, config)` | 可选，对用户传入的 prompt 做加工 |
| `callback` | `function(content, methodName, config)` | 可选，可在此统一处理返回，也可在每次调用时传入 |
| `useContext` | `0 \| 1` | 该方法是否使用上下文，默认 1 |

## 调用方式（sdk.methodName）

- **传字符串**：`sdk.searchGoods('你好')`，prompt 即为 `'你好'`
- **传对象**：`sdk.searchGoods({ prompt: '...', callback?, useContext? })`，本次可覆盖 callback、useContext

返回值为 `Promise<string>`，也可在 callback 中处理内容。

## API

- `sdk.register(methodName, config)`：注册方法
- `sdk.setApiAdapter(adapter)`：设置适配器，`adapter.request({ messages, methodName, config })` 返回 `Promise<string>`
- `sdk.setDefaultUseContext(0|1)`：设置默认是否使用上下文
- `sdk.getContext(methodName?)`：获取某方法或全部上下文
- `sdk.clearContext(methodName?)`：清空某方法或全部上下文
- `sdk[methodName](promptOrOptions)`：执行已注册方法，传入 prompt 字符串或 `{ prompt, callback?, useContext? }`
- `sdk.runFormAssistant(formTag, options)`：表单助手，见下文
- `sdk.getFormData(formTag)`：根据表单标签获取表单数据（仅读）
- `sdk.buildFormPrompt(formData, promptInstruction, supplementFieldTags?)`：将表单数据与要求拼成 prompt 字符串（仅读）

### 表单助手

用 **data 属性** 区分表单和字段：

- **表单容器**：`data-ai-form="表单标签"`、`data-ai-form-desc="表单描述"`
- **字段**：`data-ai-field="字段标签"`、`data-ai-field-desc="字段描述"`（放在 input/select/textarea 或任意元素上；input/select/textarea 取 `value`，其它取 `textContent`）

**输出元素即“要 AI 补充的字段”**：`outputElementId` 指向的元素若带有 `data-ai-field`（及 `data-ai-field-desc`），SDK 会在 prompt 中写明「需要 AI 补充的字段：xxx」，AI 会针对该字段生成内容，结果写入该元素，无需再单独指定要补充的字段。

使用前需先 `sdk.setApiAdapter(...)`；可选 `sdk.register('formAssistant', { promptProcessor?, useContext? })` 自定义。未注册时首次调用会自动用默认配置注册。

```javascript
sdk.runFormAssistant('orderForm', {
  outputElementId: 'remarkOutput',     // 输出元素 id；若该元素带 data-ai-field，即表示要 AI 补充的字段
  promptInstruction: '请根据上述信息生成备注'
})
```

内部会：根据 `formTag` 找到表单 → 收集表单描述与所有字段 → 若输出元素带 `data-ai-field` 则加入「需要 AI 补充的字段」→ 与 `promptInstruction` 拼成 prompt → 调用 `formAssistant` → 将 AI 返回写入 `outputElementId` 对应元素。

示例页面：**examples/form-assistant.html**。



## 示例

- **examples/index.html**：用户从输入框取值作为 prompt 传入，在 callback 里写入结果容器。
- **examples/form-assistant.html**：表单助手：带 `data-ai-form` / `data-ai-field` 的表单，按钮触发后拼成 prompt 并输出到指定元素。
