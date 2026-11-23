import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_DOWNLOAD_DIRECTORY = 'D:\\zdownload'
export const CONFIG_FILE = path.join(process.env.APPDATA || os.homedir(), 'mp-review-cli', 'config.json')

function readConfig(file) {
  if (!fs.existsSync(file)) return {}
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) { throw new Error(`无法读取下载配置 ${file}：${error.message}`) }
}

export function getDownloadDirectory(file = CONFIG_FILE) {
  return readConfig(file).downloadDirectory || DEFAULT_DOWNLOAD_DIRECTORY
}

export function ensureDownloadDirectory(value) {
  const directory = String(value).trim().replace(/^"(.*)"$/, '$1')
  if (!path.isAbsolute(directory)) throw new Error('下载目录必须是完整路径，例如 D:\\zdownload')
  fs.mkdirSync(directory, { recursive: true })
  fs.accessSync(directory, fs.constants.W_OK)
  return path.normalize(directory)
}

export function saveDownloadDirectory(value, file = CONFIG_FILE) {
  const directory = ensureDownloadDirectory(value)
  const config = readConfig(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ...config, downloadDirectory: directory }, null, 2) + '\n', 'utf8')
  return directory
}
