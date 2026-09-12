# 宣传页与工作台预览

完整预览使用与 GitHub Pages 相同的组装流程：

```sh
bun run build:site
bun run preview:site -- --host 127.0.0.1 --port 4174
```

打开 `http://127.0.0.1:4174/`。宣传页位于根目录，工作台位于 `app/`，
示例 SVG 位于 `assets/er-demo.svg`。目录整体也可部署到任意站点子路径。

图片的唯一源文件为 `docs/assets/er-demo.svg`。源码 HTML 使用
`../docs/assets/er-demo.svg`，因此直接打开 `landing/index.html` 或通过
开发服务器访问 `/landing/` 时也能显示图片、打开大图。发布脚本只复制 SVG
并重写生成页面中的图片地址，不修改原素材，不发布同名 PNG。

直接打开源码 HTML **只适合检查宣传页与图片**；其中的 `./app/` 工作台入口
依赖完整站点目录。验证工作台跳转请使用上面的 `build:site` / `preview:site`。
