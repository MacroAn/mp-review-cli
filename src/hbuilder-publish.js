import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'

const CONFIG_FILE = '.mp-review.json'
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ELEVATED_HELPER_PATH = path.resolve(MODULE_DIRECTORY, '..', 'elevated-hbuilder.ps1')
const DEFAULT_HBUILDER_CLI_PATHS = [
  'C:\\Program Files\\HBuilderX\\cli.exe',
  'C:\\Program Files (x86)\\HBuilderX\\cli.exe',
  'D:\\Program Files\\HBuilderX\\cli.exe',
  'D:\\HBuilderX\\cli.exe',
  'C:\\HBuilderX\\cli.exe',
]

function findProjectRoot(startDirectory = process.cwd()) {
  let current = path.resolve(startDirectory)
  while (true) {
    if (fs.existsSync(path.join(current, 'manifest.json')))
      return current
    const parent = path.dirname(current)
    if (parent === current)
      throw new Error('当前目录及其父目录中未找到 manifest.json')
    current = parent
  }
}

function readJson5(filePath) {
  return JSON5.parse(fs.readFileSync(filePath, 'utf8'))
}

function resolveProjectPath(projectRoot, configuredPath) {
  if (!configuredPath)
    return null
  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(projectRoot, configuredPath)
}

function findPrivateKey(projectRoot, configuredPath) {
  const explicitPath = process.env.MP_PRIVATE_KEY || configuredPath
  if (explicitPath)
    return resolveProjectPath(projectRoot, explicitPath)

  const keyFiles = fs.readdirSync(projectRoot)
    .filter(fileName => fileName.toLowerCase().endsWith('.key'))
  if (keyFiles.length === 1)
    return path.join(projectRoot, keyFiles[0])
  if (keyFiles.length > 1)
    throw new Error(`项目根目录存在多个 .key 文件，请在 ${CONFIG_FILE} 中配置 privateKey`)
  return null
}

function findHBuilderCli(projectRoot, configuredPath) {
  const explicitPath = process.env.HBUILDERX_CLI || process.env.MP_HBUILDER_CLI || configuredPath
  const candidates = [
    resolveProjectPath(projectRoot, explicitPath),
    ...DEFAULT_HBUILDER_CLI_PATHS,
  ].filter(Boolean)
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0] || null
}

function getGitDescription(projectRoot, fallback) {
  const result = spawnSync('git', ['log', '-1', '--format=%s'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.status === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : fallback
}

function validateConfig(config) {
  const missing = []
  if (!config.hbuilderCli || !fs.existsSync(config.hbuilderCli))
    missing.push(`HBuilderX CLI 不存在：${config.hbuilderCli || '未配置'}`)
  if (!config.privateKey || !fs.existsSync(config.privateKey))
    missing.push(`微信代码上传密钥不存在：${config.privateKey || '未配置'}`)
  if (!config.appid)
    missing.push('manifest.json 中缺少 mp-weixin.appid')
  if (!config.version)
    missing.push('manifest.json 中缺少 versionName')
  if (!Number.isInteger(config.robot) || config.robot < 1 || config.robot > 30)
    missing.push('robot 必须是 1 到 30 的整数')
  if (missing.length > 0)
    throw new Error(missing.join('；'))
}

export function getPublishConfig(startDirectory = process.cwd()) {
  const projectRoot = findProjectRoot(startDirectory)
  const manifestPath = path.join(projectRoot, 'manifest.json')
  const configPath = path.join(projectRoot, CONFIG_FILE)
  const manifest = readJson5(manifestPath)
  const localConfig = fs.existsSync(configPath) ? readJson5(configPath) : {}
  const version = String(localConfig.version || manifest.versionName || '').trim()
  const appid = String(localConfig.appid || manifest['mp-weixin']?.appid || '').trim()
  const robot = Number(localConfig.robot ?? 1)
  const config = {
    appid,
    description: String(
      process.env.MP_DESCRIPTION
      || localConfig.description
      || getGitDescription(projectRoot, `发布版本 ${version}`),
    ).trim(),
    hbuilderCli: findHBuilderCli(projectRoot, localConfig.hbuilderCli),
    privateKey: findPrivateKey(projectRoot, localConfig.privateKey),
    project: String(localConfig.project || path.basename(projectRoot)).trim(),
    projectRoot,
    robot,
    sourceMap: localConfig.sourceMap === true,
    subPackage: localConfig.subPackage ? String(localConfig.subPackage) : null,
    version,
  }
  validateConfig(config)
  return config
}

export function printPublishConfig(config) {
  console.log(`项目目录：${config.projectRoot}`)
  console.log(`HBuilderX CLI：${config.hbuilderCli}`)
  console.log(`HBuilderX 项目名：${config.project}`)
  console.log(`微信 AppID：${config.appid}`)
  console.log(`版本号：${config.version}`)
  console.log(`上传描述：${config.description}`)
  console.log(`上传密钥：${config.privateKey}`)
  console.log(`CI 机器人：${config.robot}`)
  console.log(`SourceMap：${config.sourceMap ? '是' : '否'}`)
  if (config.subPackage)
    console.log(`混合包：${config.subPackage}`)
}

export function buildPublishArgs(config) {
  const args = [
    'publish',
    '--platform', 'mp-weixin',
    '--project', config.project,
    '--upload', 'true',
    '--appid', config.appid,
    '--description', config.description,
    '--version', config.version,
    '--privatekey', config.privateKey,
    '--robot', String(config.robot),
  ]
  if (config.sourceMap)
    args.push('--sourceMap', 'true')
  if (config.subPackage)
    args.push('--subPackage', config.subPackage)
  return args
}

function executeCli(cliPath, args, { cwd, echo = false, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const output = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled)
        return
      settled = true
      child.kill()
      reject(new Error(`HBuilderX CLI 命令超时：${args.join(' ')}`))
    }, timeoutMs)

    const collect = (target, chunk) => {
      output.push(Buffer.from(chunk))
      if (echo)
        target.write(chunk)
    }
    child.stdout.on('data', chunk => collect(process.stdout, chunk))
    child.stderr.on('data', chunk => collect(process.stderr, chunk))
    child.once('error', (error) => {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      resolve({ code, output: Buffer.concat(output).toString('utf8') })
    })
  })
}

function isCliNotReady(output) {
  return output.includes('未检测到已打开的HBuilderX')
}

export function parseHBuilderProcessIds(tasklistOutput) {
  return tasklistOutput
    .split(/\r?\n/)
    .map(line => line.match(/^"HBuilderX\.exe","(\d+)"/i)?.[1])
    .filter(Boolean)
}

function getHBuilderProcessIds() {
  const result = spawnSync('tasklist', [
    '/FI', 'IMAGENAME eq HBuilderX.exe',
    '/FO', 'CSV',
    '/NH',
  ], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.status === 0 ? parseHBuilderProcessIds(result.stdout) : []
}

export function hasRunAsAdminFlag(registryOutput) {
  return /RUNASADMIN/i.test(registryOutput)
}

function isCurrentProcessElevated() {
  const result = spawnSync('net', ['session'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  return result.status === 0
}

function isHBuilderConfiguredToRunAsAdmin(config) {
  const hbuilderExecutable = path.join(path.dirname(config.hbuilderCli), 'HBuilderX.exe')
  const registryKeys = [
    'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
    'HKLM\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
  ]
  return registryKeys.some((registryKey) => {
    const result = spawnSync('reg', ['query', registryKey, '/v', hbuilderExecutable], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return result.status === 0 && hasRunAsAdminFlag(`${result.stdout}\n${result.stderr}`)
  })
}

function requiresElevatedHBuilderCli(config) {
  return isHBuilderConfiguredToRunAsAdmin(config) && !isCurrentProcessElevated()
}

export function assertPublishSucceeded(code, output) {
  const failurePatterns = [
    /未检测到已打开的HBuilderX/,
    /发行[^\r\n]*失败/,
    /上传[^\r\n]*失败/,
    /编译[^\r\n]*失败/,
    /(^|\r?\n)\s*(error|failed|failure)\b/im,
  ]
  if (code !== 0 || failurePatterns.some(pattern => pattern.test(output)))
    throw new Error(`HBuilderX 发行上传失败${code === 0 ? '' : `，退出码：${code}`}`)
}

async function ensureHBuilderXReady(config) {
  let status = await executeCli(config.hbuilderCli, ['help'], {
    cwd: path.dirname(config.hbuilderCli),
  })
  if (status.code === 0 && !isCliNotReady(status.output))
    return

  const existingProcessIds = getHBuilderProcessIds()
  if (existingProcessIds.length > 0) {
    throw new Error(
      `检测到普通方式启动且未连接 CLI 的 HBuilderX 进程（PID ${existingProcessIds.join(', ')}）。`
      + '请保存工作并完全退出所有 HBuilderX 窗口，然后重新运行 mp full',
    )
  }

  await executeCli(config.hbuilderCli, ['open'], {
    cwd: path.dirname(config.hbuilderCli),
    timeoutMs: 20000,
  })

  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    status = await executeCli(config.hbuilderCli, ['help'], {
      cwd: path.dirname(config.hbuilderCli),
    })
    if (status.code === 0 && !isCliNotReady(status.output))
      return
  }

  throw new Error('HBuilderX 未建立 CLI 连接。请保存工作并完全退出所有 HBuilderX 窗口，然后重新运行 mp full')
}

function encodePowerShellCommand(command) {
  return Buffer.from(command, 'utf16le').toString('base64')
}

async function executeElevatedPublish(config, args) {
  if (!fs.existsSync(ELEVATED_HELPER_PATH))
    throw new Error(`管理员辅助脚本不存在：${ELEVATED_HELPER_PATH}`)

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-review-cli-'))
  const requestPath = path.join(temporaryDirectory, 'request.json')
  const resultPath = path.join(temporaryDirectory, 'result.json')
  fs.writeFileSync(requestPath, JSON.stringify({
    arguments: args,
    cliPath: config.hbuilderCli,
    cwd: config.projectRoot,
    resultPath,
  }), 'utf8')

  const quote = value => `'${value.replaceAll("'", "''")}'`
  const helperCommand = `& ${quote(ELEVATED_HELPER_PATH)} -RequestPath ${quote(requestPath)}`
  const helperEncodedCommand = encodePowerShellCommand(helperCommand)
  const launcherCommand = [
    "$ProgressPreference = 'SilentlyContinue';",
    "$ErrorActionPreference = 'Stop';",
    '$process = Start-Process',
    "-FilePath 'powershell.exe'",
    '-Verb RunAs',
    '-WindowStyle Hidden',
    '-Wait',
    '-PassThru',
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${helperEncodedCommand}')`,
    '; exit $process.ExitCode',
  ].join(' ')

  try {
    const launcher = await executeCli('powershell.exe', [
      '-NoLogo',
      '-NonInteractive',
      '-NoProfile',
      '-EncodedCommand', encodePowerShellCommand(launcherCommand),
    ], {
      cwd: config.projectRoot,
      echo: true,
      timeoutMs: 30 * 60 * 1000,
    })

    if (!fs.existsSync(resultPath)) {
      throw new Error(
        launcher.code === 0
          ? '管理员 HBuilderX 辅助进程未返回结果'
          : '管理员授权被取消或辅助进程启动失败',
      )
    }

    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    if (result.output)
      process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`)
    return { code: Number(result.exitCode), output: String(result.output || '') }
  }
  finally {
    if (fs.existsSync(requestPath))
      fs.unlinkSync(requestPath)
    if (fs.existsSync(resultPath))
      fs.unlinkSync(resultPath)
    fs.rmdirSync(temporaryDirectory)
  }
}

export async function runHBuilderPublish(config) {
  const args = buildPublishArgs(config)
  const needsElevation = requiresElevatedHBuilderCli(config)

  if (needsElevation)
    console.log('[发行 1/3] HBuilderX 以管理员身份运行，请在 UAC 窗口中允许本次上传')
  else {
    console.log(`[发行 1/3] 正在连接 HBuilderX：${config.hbuilderCli}`)
    await ensureHBuilderXReady(config)
  }

  console.log(`[发行 2/3] 正在编译并上传版本 ${config.version}`)
  const result = needsElevation
    ? await executeElevatedPublish(config, args)
    : await executeCli(config.hbuilderCli, args, {
        cwd: config.projectRoot,
        echo: true,
        timeoutMs: 30 * 60 * 1000,
      })
  assertPublishSucceeded(result.code, result.output)
  console.log(`[发行 3/3] HBuilderX 版本 ${config.version} 上传成功`)
}
