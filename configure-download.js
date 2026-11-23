import readline from 'node:readline/promises'
import { CONFIG_FILE, getDownloadDirectory, saveDownloadDirectory } from './src/download-config.js'

try {
  let value
  if (process.argv[2] === '--set' && process.argv.length === 4) {
    value = process.argv[3]
  }
  else if (process.argv.length === 2) {
    const current = getDownloadDirectory()
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      console.log(`当前二维码下载目录：${current}`)
      value = (await terminal.question('请输入下载目录（直接回车保留当前设置）：')).trim() || current
    }
    finally { terminal.close() }
  }
  else {
    throw new Error('使用：node configure-download.js，或 node configure-download.js --set "D:\\zdownload"')
  }
  console.log(`下载目录已保存：${saveDownloadDirectory(value)}`)
  console.log(`配置文件：${CONFIG_FILE}`)
}
catch (error) {
  console.error(`下载目录配置失败：${error.message}`)
  process.exitCode = 1
}
