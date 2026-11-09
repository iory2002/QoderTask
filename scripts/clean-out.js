/**
 * 编译前清空产物目录。
 *
 * tsc 只覆盖、不删除：删掉的模块会以旧的 .js 留在产物里，
 * 结果就是「源码已经去掉的功能，vsix 里还在」——
 * 之前退役侧边栏时踩过一次（out/），删测试文件时又踩了一次（.test-out/）。
 */
const fs = require('fs');
const path = require('path');

for (const name of ['out', '.test-out']) {
    fs.rmSync(path.join(__dirname, '..', name), { recursive: true, force: true });
}
