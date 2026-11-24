# Toolbox 音频工坊 · Tauri 2 / Rust

这个目录是同一仓库里的独立桌面试验，不替代根目录的 TS CLI / TUI，也不依赖 Electron 图片版。界面是静态 HTML/CSS/JS；Rust 接收系统拖放和原生文件选择、预览路径、调用本机 FFmpeg。运行桌面版不需要 Node.js 或浏览器标签页，不上传文件。

## 本机开发运行

1. 按 [Tauri 2 官方先决条件](https://v2.tauri.app/start/prerequisites/)准备 Rust 和系统组件。Windows 用 MSVC / WebView2，macOS 用 WKWebView，Linux 用 GTK / WebKitGTK 4.1。
2. 安装带 libvorbis 的 FFmpeg，使应用可从 PATH 找到，或设置 `ABOOM_FFMPEG` 为可执行文件的绝对路径。GUI 进程可能不继承 shell 里的 PATH，尤其是从 macOS Finder 启动时。
3. 从仓库根目录执行：

```sh
cargo run --locked --manifest-path desktop-tauri/Cargo.toml
```

将一个或多个 WAV 文件拖进窗口，或点「选择文件」。加入队列不会写入文件。「预览输出」检查路径和同名冲突，不解码音频；点击「开始转换」后，逐个把第一条音轨编码为 Vorbis OGG（质量 5），另存到各自的原目录，不修改 WAV，也不覆盖同名 OGG。进度按已处理的文件数显示。首版仅支持 WAV 文件；没有文件夹递归、转换取消、图片或 Excel 界面。

## 验证

```sh
cargo test --locked --manifest-path desktop-tauri/Cargo.toml
cargo test --locked --manifest-path desktop-tauri/Cargo.toml -- --ignored
```

第二行需要 FFmpeg。还可单独用 `rustc --edition=2021 --test desktop-tauri/src/audio.rs -o audio-tests` 编译核心测试，不依赖 WebView 开发库。

## 体积

通过 `cargo build --release --locked --manifest-path desktop-tauri/Cargo.toml` 测量当前平台的发行构建可执行文件，以及它单独压缩后的大小。默认关闭 Tauri 打包；不提供发布安装包，不捆绑 Node、FFmpeg 或 WebView。维护者应在同平台、同压缩方式下对照 Electron，不把 Linux 二进制当作 Windows 包体积的实测。

界面逻辑的开发测试（模拟 Tauri 事件，不代表系统实拖）：`node --test desktop-tauri/tests/ui.test.mjs`。
