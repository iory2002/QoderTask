/**
 * 编译前清空 out/：tsc 不会删除已失效的产物，
 * 上一次编译留下的旧文件会被一起打进 vsix（等于死代码仍在发布）。
 */
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'out');
fs.rmSync(target, { recursive: true, force: true });
