# 部署到手机可直接访问的网址

现在的项目已经包含 Render 部署配置。推荐先使用 Render 的免费 Web Service：

- 不需要购买服务器或域名
- 自动提供 HTTPS 地址
- Android、iPhone 和 Windows 共用同一个网址
- 项目不需要数据库，也不需要填写密钥

## 第一步：把代码放到 GitHub

Render 需要从 GitHub 读取项目代码。

1. 打开 [GitHub](https://github.com/) 并注册或登录。
2. 点击右上角 `+`，选择 `New repository`。
3. 仓库名称填写 `xianyu-watermark-free-downloader`。
4. 选择 `Private` 或 `Public` 均可，不要勾选自动创建 README。
5. 创建后点击 `uploading an existing file`。
6. 把这个项目文件夹中的以下内容拖进去：

```text
public/
scripts/
server.js
package.json
Dockerfile
render.yaml
README.md
DEPLOY.md
```

不要上传 `.git`、`.reference` 或 `node_modules`。

7. 点击 `Commit changes` 保存。

## 第二步：在 Render 创建应用

1. 打开 [Render](https://render.com/)。
2. 使用 GitHub 账号登录。
3. 进入 Dashboard，点击 `New`，选择 `Blueprint`。
4. 选择刚才创建的 GitHub 仓库。
5. Render 会自动识别项目里的 `render.yaml`。
6. 点击 `Apply` 或 `Deploy`。
7. 等待状态变成 `Live`。

部署成功后，Render 会给出类似下面的网址：

```text
https://xianyu-watermark-free-downloader.onrender.com
```

实际地址以 Render 页面显示的为准。

## 第三步：在手机上使用

Android：

1. 使用 Chrome 打开 Render 网址。
2. 点击右上角菜单。
3. 选择“安装应用”或“添加到主屏幕”。

iOS：

1. 使用 Safari 打开 Render 网址。
2. 点击底部的“分享”按钮。
3. 选择“添加到主屏幕”。

安装后可以像普通 App 一样从主屏幕打开。

## 注意事项

- Render 免费实例长时间无人访问后会休眠，重新打开时可能需要等待几十秒。
- 如果 Render 地址在当前网络访问较慢，可以稍后再试，或改用国内云服务器。
- 后续修改 GitHub 仓库代码后，Render 会自动重新部署。
- 健康检查地址是 `/api/health`。
- 如果部署失败，在 Render 的 `Logs` 页面查看错误信息。

## 不使用 GitHub 的服务器部署

项目也包含 `Dockerfile`，可以部署到任何支持 Docker 的服务器。服务器需要设置平台提供的 `PORT` 环境变量，并开放对应的 HTTPS 入口。不要只上传 `public` 文件夹，因为图片解析依赖 `server.js` 后端。
