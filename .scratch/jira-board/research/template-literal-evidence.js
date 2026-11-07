/**
 * 证据脚本：复现「\s 被误匹配成字母 s」的真实病因。
 *
 * 扩展里的 HTML 是整体塞进一个模板字符串的（TodoWebviewProvider._getHtmlContent），
 * 模板字符串里的 \s 会被当成普通转义序列处理 —— 反斜杠消失，只剩 s。
 * 也就是说：不是引擎坏了，是模板字符串把反斜杠吃掉了。
 *
 * 跑法：node .scratch/jira-board/research/template-literal-evidence.js
 */

// 1) 模拟扩展源码的写法：正则写在模板字符串里
const emittedHtml = `<script>
  const key = status.toLowerCase().replace(/\s+/g, '-');
</script>`;

// 2) 正确写法：反斜杠转义
const emittedHtmlEscaped = `<script>
  const key = status.toLowerCase().replace(/\\s+/g, '-');
</script>`;

function extractScript(html) {
    return html.split('<script>')[1].split('</script>')[0].trim();
}

console.log('--- 写法 A：模板字符串里直接写 \\s ---');
console.log('浏览器实际收到的脚本：', extractScript(emittedHtml));
const a = new Function('status', extractScript(emittedHtml).replace('const key = ', 'return '));
console.log('对 "In Progress" 求值：', a('In Progress'));

console.log();
console.log('--- 写法 B：写成 \\\\s ---');
console.log('浏览器实际收到的脚本：', extractScript(emittedHtmlEscaped));
const b = new Function('status', extractScript(emittedHtmlEscaped).replace('const key = ', 'return '));
console.log('对 "In Progress" 求值：', b('In Progress'));
