# mp-review-cli

在 Windows 命令行中自动提交微信小程序审核。

`mp-review-cli` 使用无头 Chrome/Edge 操作微信公众平台：在终端显示登录二维码，扫码后选择最新的开发版本，自动完成审核须知、提交审核以及可能出现的二次确认。

> 当前版本只负责提交审核，不编译或上传小程序代码。运行 `mp` 前，必须先通过 HBuilderX、微信开发者工具或其他 CI 工具上传开发版本。

## 功能

- 在当前 CMD/PowerShell 中显示微信登录二维码
- 自动读取微信公众平台开发版本
- 按提交时间选择最新开发版本
- 自动勾选并通过审核须知
- 自动点击最终提交审核
- 自动处理微信可能出现的隐私二次确认
- 单行显示当前执行进度
- 支持 CMD、Windows PowerShell 和 PowerShell 7
- 提供 `mp`、`mp.cmd` 和 `wxmp` 命令
- 提供一键安装 BAT 脚本

## 执行流程

```text
HBuilderX/开发者工具上传代码
              |
              v
           运行 mp
              |
              v
       终端显示微信登录二维码
              |
              v
       扫码并选择目标小程序
              |
              v
       选择最新的开发版本
              |
              v
       自动填写既有审核信息
              |
              v
          提交代码审核
```

## 环境要求

- Windows 10/11
- Node.js 20 或更高版本
- npm
- Google Chrome 或 Microsoft Edge
- 微信公众平台账号具有目标小程序的版本管理权限
- 微信公众平台已经存在可提审的开发版本
- 建议目标小程序至少手工提审过一次，使平台保存类目、审核页面等资料

## 安装

### 一键安装

下载或克隆项目后，双击：

```text
install.bat
```

安装脚本会：

1. 检查 Node.js 和 npm
2. 安装项目依赖
3. 将 `mp` 和 `wxmp` 安装到当前 Windows 用户
4. 将 `%APPDATA%\npm` 加入用户 PATH（如果尚未加入）
5. 配置 Windows PowerShell 和 PowerShell 7 的 `mp` 命令
6. 验证安装版本

安装完成后，请重新打开终端。

### 手工安装

在项目目录运行：

```cmd
npm install
npm install -g --prefix "%APPDATA%\npm" --install-links=true .
```

手工安装不会自动处理 PowerShell 的 `mp` 别名冲突，PowerShell 中可使用 `mp.cmd` 或 `wxmp`。

## 使用

先通过 HBuilderX 或微信开发者工具上传开发版本，然后进入任意目录运行：

```cmd
mp
```

终端会显示微信登录二维码。扫码并在微信中选择目标小程序后，程序将直接执行真实提审。

查看帮助和版本：

```cmd
mp --help
mp --version
```

## PowerShell 的 mp 冲突

PowerShell 内置了以下只读别名：

```powershell
mp -> Move-ItemProperty
```

`install.bat` 会在当前用户的 Windows PowerShell 和 PowerShell 7 Profile 中加入带边界标记的配置，移除该别名并将 `mp` 映射到本工具。安装后需要重新打开 PowerShell。

如果 Profile 被执行策略禁用，可直接使用：

```powershell
mp.cmd
```

或者使用无冲突的备用命令：

```powershell
wxmp
```

## 自动化与风险

运行 `mp` 会产生真实的微信小程序提审操作，程序不会在最终提交前要求输入确认。

程序还会自动接受微信可能出现的隐私二次确认。如果小程序的隐私保护指引与实际调用的隐私接口不一致，相关接口权限可能受到影响。使用前应在微信公众平台确认：

- 服务类目正确
- 审核页面正确
- 测试账号及说明完整
- 用户隐私保护指引正确
- 代码中使用的隐私接口已经声明并获得权限

建议先在非关键小程序或可撤回的开发版本上验证完整流程。

## 安全说明

- 项目不包含微信 AppSecret、代码上传密钥或固定 Access Token
- 微信登录二维码为临时凭证，请勿截图传播
- 浏览器会在命令结束后关闭，不持久化登录状态
- 不要把微信代码上传密钥、Cookie 或登录缓存提交到公开仓库
- 小程序 AppID 通常不是秘密，但私钥和 AppSecret 必须保密

## 常见问题

### 运行 mp 后出现 Move-ItemProperty 参数提示

当前终端仍在使用 PowerShell 内置别名。重新运行 `install.bat` 并打开新的 PowerShell，或者执行：

```powershell
mp.cmd
```

也可以执行：

```powershell
wxmp
```

### 未找到可提交审核的开发版本

先在 HBuilderX 或微信开发者工具中上传代码，确认微信公众平台的版本管理页面存在开发版本。

### 未找到最终提交审核按钮

可能原因：

- 审核资料页面仍在加载
- 必填审核资料不完整
- 当前已有审核中的版本
- 微信公众平台页面结构已经更新

当前实现会等待最终按钮出现；如果仍然失败，请提供终端错误和页面截图。

### 登录二维码识别失败

重新运行 `mp` 获取新二维码，并确认网络可以访问 `mp.weixin.qq.com`。二维码具有时效性，过期后不能继续使用。

## 开发

安装依赖：

```cmd
npm install
```

执行测试、语法检查和依赖审计：

```cmd
npm test
npm run check
npm audit --omit=dev
```

项目结构：

```text
mp-review-cli/
|-- src/
|   |-- cli.js
|   `-- wechat-review.js
|-- test/
|   `-- review-dialog.test.js
|-- configure-powershell.ps1
|-- install.bat
|-- LICENSE
|-- package.json
`-- README.md
```

## 当前限制

- 依赖微信公众平台网页结构，不是微信官方提审 API
- 微信后台改版后可能需要更新页面选择器
- 每次运行需要扫码登录
- 当前不支持 HBuilderX CLI 自动编译和上传
- 当前不校验开发版本是否对应某次指定的本地构建

## 路线图

- 集成 HBuilderX `cli publish --platform mp-weixin`
- 自动读取 `manifest.json` 的 AppID 和版本号
- 上传成功后校验微信后台版本号再提审
- 支持自定义上传描述、CI 机器人编号和代码上传密钥路径
- 增加失败页面诊断和可选截图

## 免责声明

本项目不是微信或 DCloud 官方工具。使用者应自行确认微信公众平台规则、审核资料和隐私声明。因自动提审、平台页面变化、账号权限或错误配置产生的影响，由使用者自行承担。

## License

本项目使用 [MIT License](LICENSE)。
