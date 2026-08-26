# mp-review-cli

在 Windows 命令行中自动发行、上传并提交微信小程序审核。

`mp-review-cli` 使用无头 Chrome/Edge 操作微信公众平台：在终端显示登录二维码，扫码后选择最新的开发版本，自动完成审核须知、提交审核以及可能出现的二次确认。

> `mp` 保持原有行为，只提交微信公众平台中已经上传的开发版本；`mp full` 才会调用 HBuilderX CLI 编译上传，并在上传成功后提审同一版本。

## 功能

- 在当前 CMD/PowerShell 中显示微信登录二维码
- 自动读取微信公众平台开发版本
- 按提交时间选择最新开发版本
- 自动勾选并通过审核须知
- 自动点击最终提交审核
- 自动处理微信可能出现的隐私二次确认
- 固定两行显示“当前项目”和“当前步骤”，HBuilderX 上传阶段显示 `.`、`..`、`...` 加载动画
- 自动选择“需登录账号才可使用”，并交互式填写审核测试账号、密码和备注
- 支持 CMD、Windows PowerShell 和 PowerShell 7
- 提供 `mp`、`mp.cmd` 和 `wxmp` 命令
- 提供一键安装 BAT 脚本
- 可调用 HBuilderX CLI 编译并上传 uni-app 微信小程序
- 自动读取 `manifest.json` 的微信 AppID 和版本号
- 上传成功后按版本号约束提审目标，避免误提审旧版本
- 支持项目级 HBuilderX 路径、上传密钥、CI 机器人等配置

## 执行流程

```text
mp（仅提审）
  -> 读取微信公众平台最新开发版本
  -> 终端扫码登录
  -> 自动提交审核

mp full（完整流程）
  -> 读取 manifest.json 和 .mp-review.json
  -> HBuilderX CLI 编译 mp-weixin
  -> 上传代码到微信公众平台
  -> 终端扫码登录
  -> 校验并选择本次上传的版本号
  -> 自动提交审核
```

## 环境要求

- Windows 10/11
- Node.js 20 或更高版本
- npm
- Google Chrome 或 Microsoft Edge
- 微信公众平台账号具有目标小程序的版本管理权限
- 建议目标小程序至少手工提审过一次，使平台保存类目、审核页面等资料
- 仅使用 `mp` 时，微信公众平台必须已经存在可提审的开发版本
- 使用 `mp full` 时，需要 HBuilderX 3.3.7+ 和微信代码上传密钥
- 使用 `robot` 参数需要 HBuilderX 3.6.18+ 及新版微信小程序上传 CI 插件
- uni-app 项目需要已经导入当前机器的 HBuilderX 项目管理器

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

### 仅提交审核

先通过 HBuilderX 或微信开发者工具上传开发版本，然后运行：

```cmd
mp
```

终端会显示微信登录二维码。扫码并在微信中选择目标小程序后，程序将直接执行真实提审。

也可以显式使用：

```cmd
mp review
```

### 检查 HBuilderX 发行配置

在 uni-app 项目目录运行：

```cmd
mp config
```

该命令只读取并校验配置，不启动 HBuilderX、不上传代码，也不提审。它会显示解析后的项目目录、HBuilderX CLI、项目名、AppID、版本号、上传描述、密钥路径和 CI 机器人编号。

### 完整发行、上传和提审

```cmd
mp full
```

`mp full` 会执行真实的 HBuilderX 编译上传和微信提审，并且不要求二次输入确认。HBuilderX 返回非零退出码时，流程会立即停止，不会进入提审。

需要查看自动填写结果时，使用可视化调试模式：

```cmd
mp full --visible
```

该模式会显示 Chrome，在填写测试账号、密码和测试备注后滚动到对应区域，并暂停在最终提交之前。检查或手工修改完成后，在终端按 Enter 才继续提交。普通 `mp full` 仍保持无头、全自动、不暂停。

仅检查已经上传的开发版本时也可以使用：

```cmd
mp review --visible
```

完整流程默认隐藏 HBuilderX 的编译、warning、上传调试和 PowerShell 内部日志。第一行固定显示当前项目，第二行实时覆盖当前步骤；HBuilderX 编译上传期间循环显示 `.`、`..`、`...` 加载动画。二维码从第三行开始显示，扫码登录成功后自动清除二维码区域，并继续在第二行更新进度。运行 `mp config` 时仍会显示完整配置，失败时第二行会保留错误。

进入新版微信审核资料页面后，程序会选择“需登录账号才可使用”，并在终端第二行要求输入测试账号和测试密码。密码使用 `*` 遮挡且不会写入本地配置或日志。随后自动填写：

```text
线上真实生产环境,请手下留情
测试账号: 用户输入的账号
测试密码: 用户输入的密码
```

这些内容会提交给微信审核人员，请务必使用专门的审核测试账号，不要使用员工、管理员或生产用户的真实密码。

### 配置文件

在 uni-app 项目根目录创建 `.mp-review.json`。可以复制本仓库的 `.mp-review.example.json`：

```json5
{
  // 不同用户可以配置自己的 HBuilderX 安装位置
  "hbuilderCli": "C:\\Program Files\\HBuilderX\\cli.exe",

  // 相对路径以当前 uni-app 项目根目录为基准
  "privateKey": "./private.wx-appid.key",

  // 以下配置均为可选
  "project": "my-uni-app-project",
  "robot": 1,
  "sourceMap": false,
  "subPackage": "hybrid-package",
  "description": "本次上传说明"
}
```

默认值和自动发现规则：

- `hbuilderCli`：优先读取环境变量 `HBUILDERX_CLI`/`MP_HBUILDER_CLI`，其次读取配置文件，再检查常见安装路径
- `privateKey`：优先读取 `MP_PRIVATE_KEY`，其次读取配置文件；项目根目录只有一个 `.key` 文件时自动使用
- `appid`：读取 `manifest.json` 的 `mp-weixin.appid`
- `version`：读取 `manifest.json` 的 `versionName`
- `project`：默认使用项目目录名
- `description`：优先读取 `MP_DESCRIPTION` 或配置文件，否则使用最近一次 Git 提交说明
- `robot`：默认为 `1`，有效范围为 1 到 30
- `sourceMap`：默认为 `false`

`.mp-review.json` 通常包含当前机器路径，建议将它加入业务项目的 `.gitignore`。微信上传密钥本身也不得提交到 Git 仓库。

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

### HBuilderX CLI 或上传密钥不存在

在业务项目根目录创建 `.mp-review.json`，配置当前机器的 `hbuilderCli` 和 `privateKey`，然后运行 `mp config` 检查。路径中包含反斜杠时，JSON 字符串需要写成双反斜杠。

### HBuilderX 提示找不到项目

先在当前机器的 HBuilderX 中导入并打开 uni-app 项目。`.mp-review.json` 的 `project` 必须与 HBuilderX 项目管理器中显示的项目名称一致。

### 未检测到已打开的 HBuilderX

官方文档只要求通过 `cli open` 启动 HBuilderX，并没有要求日常使用时必须关闭 HBuilderX。参见 [HBuilderX CLI 概述](https://hx.dcloud.net.cn/cli/README)。

如果 HBuilderX 被配置为“以管理员身份运行”，普通权限的 CLI 无法直接与它建立连接。此时仍然在普通 CMD/PowerShell 中运行 `mp full`：工具会弹出一次 Windows UAC，只让 HBuilderX 编译上传辅助进程获得管理员权限；上传结束后回到原来的普通终端显示二维码并继续提审。无需关闭 HBuilderX，也不建议为了二维码在管理员终端中运行整段流程。

权限一致但仍未连接时，可能是普通方式启动的旧 HBuilderX 实例没有 CLI 通道。保存文件并完全退出所有 HBuilderX 窗口后重新运行 `mp full`，工具会通过官方 `cli open` 启动。工具不会强制关闭 HBuilderX，以免丢失未保存内容。

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
|   |-- hbuilder-publish.js
|   |-- progress.js
|   `-- wechat-review.js
|-- test/
|   |-- hbuilder-publish.test.js
|   `-- review-dialog.test.js
|-- .mp-review.example.json
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
- HBuilderX CLI 发行目前仅面向 Windows 的 uni-app/uni-app x `mp-weixin`
- `mp full` 依赖 HBuilderX 已正确安装、项目已导入且微信上传 CI 插件可用
- 仅使用 `mp` 时仍然按提交时间选择最新开发版本，无法对应某次指定的本地构建

## 路线图

- 增加失败页面诊断和可选截图
- 支持可选的扫码登录状态缓存
- 支持更多 HBuilderX 发行平台和非 Windows 环境

## 免责声明

本项目不是微信或 DCloud 官方工具。使用者应自行确认微信公众平台规则、审核资料和隐私声明。因自动提审、平台页面变化、账号权限或错误配置产生的影响，由使用者自行承担。

## License

本项目使用 [MIT License](LICENSE)。
