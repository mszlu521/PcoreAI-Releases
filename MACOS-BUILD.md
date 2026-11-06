# macOS 构建

此公开仓库使用 GitHub 标准 macOS runner 构建 PcoreAI。应用源码保留在私有仓库 `mszlu521/pcoreAI`，不会作为源码附件或临时构建产物上传。

## 手动构建

打开 Actions → **Build macOS from private source** → **Run workflow**。

- `source_sha`：私有源码仓库中待构建提交的完整 40 位 SHA。必须先把本地改动保存到私有仓库，再使用对应提交，不能填分支名。
- `publish`：关闭时只生成临时安装包；开启时，两种架构都通过验证后，将安装包追加到同版本的现有公开 Release。工作流不会替换不同内容的同名文件，也不会修改已有 Windows 安装包。

Intel 使用 `macos-15-intel`，Apple 芯片使用 `macos-15`。两者均为标准 runner，公开仓库的构建计算免费；本工作流没有付费大规格 runner，也不会触发私有源码仓库的构建工作流。仅仓库所有者可手动运行。

每种架构输出 DMG、ZIP、文件大小以及 SHA-512/SHA-256 校验信息。临时产物只保留一天，正式下载使用 Releases。

## 私有源码读取

仓库 Secret `PCOREAI_SOURCE_SSH_KEY` 保存只读部署私钥，其公钥仅登记到私有 PcoreAI 源码仓库。该密钥不能写入源码，也不能读取其他私有仓库。Checkout 不保留凭据，不缓存私有源码。

密钥泄露或不再使用时，删除私有源码仓库 Settings → Deploy keys 中对应的 `PcoreAI Releases macOS read-only build` 条目，并删除本仓库的同名 Secret。重新配置必须创建新的一对密钥。

## 构建和验证

工作流依次安装依赖、运行单元测试、构建应用、验证包内源码和架构、启动应用执行并取消本地命令、启动并退出原生终端、验证资源管理器预览以及更新缓存/重启流程。任何阶段失败都会阻止正式发布。

这些包使用免费的 ad hoc 本地签名，**没有 Apple Developer ID 签名和 Apple 公证**。首次打开可能被 Gatekeeper 拦截，需要在确认来源后通过 macOS 隐私与安全设置手动允许；本地签名不等于 Apple 信任认证。

## 失败诊断

普通日志只显示阶段结果。失败时，原始诊断输出通过仓库 Secret `PCOREAI_BUILD_LOG_KEY` 使用 AES-256-GCM 加密，再上传一天有效的诊断附件，避免在公开日志中披露源码片段。

只有持有该密钥的维护者可以解密：

```sh
node .github/scripts/build-diagnostics.cjs decrypt /private/path/build-log.key pcoreai-package.log.enc pcoreai-package.log
```

解密密钥不得提交到仓库、放入 issue 或粘贴到工作流输入中。
