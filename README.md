# 闲鱼无水印下载

一个可安装到 Android、iPhone/iPad 与 Windows 主屏幕的闲鱼商品素材保存器。粘贴闲鱼分享文案后，应用只提取当前公开商品详情中的原图、原视频与描述文字。

## 启动

需要 Node.js 20 或更高版本。

```powershell
node server.js
```

浏览器打开 `http://localhost:4318`。

也可以直接双击项目中的 `启动闲鱼无水印下载.cmd`，它会自动寻找电脑上的 Node.js、启动项目并打开浏览器。

如果 Node.js 不在系统 `PATH` 中，可以打开 PowerShell 后运行：

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

局域网内的手机可以使用电脑的局域网 IP 访问，例如 `http://192.168.1.20:4318`。首次使用时请允许防火墙访问该端口。

## 安装为应用

- Android Chrome：从浏览器菜单选择“安装应用”或“添加到主屏幕”。
- iPhone/iPad Safari：点击“分享”，再选择“添加到主屏幕”。
- Windows Chrome/Edge：点击地址栏右侧的安装图标，或从浏览器菜单选择“安装”。

安装后可全屏运行。界面壳会缓存，但解析和素材下载需要联网。

## 功能

- 自动读取整段闲鱼分享文案中的短链接。
- 仅请求当前商品的公开详情字段。
- “保存全部”会逐个直接下载原图和原视频，不生成压缩包。
- 保存时自动复制商品描述。
- 每张图片和视频也可单独保存。
- 不包含推荐商品、卖家资料或其他页面内容。

## 部署说明

项目没有第三方运行时依赖。可以使用 [DEPLOY.md](DEPLOY.md) 中的 Render 步骤部署到 HTTPS 网站；项目也包含可直接使用的 `Dockerfile`。

不支持已删除、已下架、私密或需要登录权限的商品。请仅保存你有权使用或发布的素材。
