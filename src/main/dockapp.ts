import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { basename, join, resolve } from 'path'
import type { DockAppRequest, DockAppResult } from '../shared/types'

const EXEC_NAME = 'ContextWorkspaceClient'

/**
 * Generates a wrapper .app bundle for one context, giving it its own Dock
 * tile, name and icon.
 *
 * The bundle is an APFS copy-on-write clone (`cp -c`) of the running app's
 * bundle — instant to create and sharing disk blocks with the original, so it
 * costs almost no space. A symlinked Frameworks directory is NOT an option:
 * Electron SIGTRAPs on startup when Contents/Frameworks resolves outside the
 * bundle. The clone's app code is replaced with a small stub that pins the
 * context env vars and requires the real compiled main entry; the plist is
 * patched with the context's identity and the bundle re-signed ad-hoc.
 */
export function createDockApp(request: DockAppRequest): DockAppResult {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Dock apps are only supported on macOS for now' }
  }
  try {
    const appsDir = join(app.getPath('home'), 'Applications', 'ContextWorkspace Apps')
    const safeName = request.contextName.replace(/[/:]+/g, '-').trim() || 'Context'
    const bundle = join(appsDir, `${safeName}.app`)
    const contents = join(bundle, 'Contents')
    const resourcesDir = join(contents, 'Resources')
    const stubDir = join(resourcesDir, 'app')
    const plistPath = join(contents, 'Info.plist')

    // e.g. …/node_modules/electron/dist/Electron.app (dev) or the installed
    // ContextWorkspace.app (packaged).
    const sourceBundle = resolve(process.execPath, '..', '..', '..')
    const sourceExecName = basename(process.execPath)

    rmSync(bundle, { recursive: true, force: true })
    mkdirSync(appsDir, { recursive: true })
    execFileSync('cp', ['-Rc', sourceBundle, bundle], { stdio: 'ignore' })

    // Replace the app payload with the context stub. The stub's package name
    // must match the main app's so Chromium's cookie-encryption key (Keychain
    // item "<name> Safe Storage") stays the same — otherwise copied sessions
    // could not be decrypted.
    rmSync(stubDir, { recursive: true, force: true })
    rmSync(join(resourcesDir, 'app.asar'), { force: true })
    mkdirSync(stubDir, { recursive: true })
    const entry = join(app.getAppPath(), 'out', 'main', 'index.js')
    writeFileSync(
      join(stubDir, 'package.json'),
      JSON.stringify({
        name: 'contextworkspace',
        productName: 'contextworkspace',
        version: app.getVersion() || '0.1.0',
        main: 'index.js',
        private: true
      })
    )
    writeFileSync(
      join(stubDir, 'index.js'),
      [
        `process.env.CW_CONTEXT_ID = ${JSON.stringify(request.contextId)}`,
        `process.env.CW_CONTEXT_NAME = ${JSON.stringify(request.contextName)}`,
        `process.env.CW_MAIN_USERDATA = ${JSON.stringify(app.getPath('userData'))}`,
        `require(${JSON.stringify(entry)})`,
        ''
      ].join('\n')
    )

    if (sourceExecName !== EXEC_NAME) {
      renameSync(join(contents, 'MacOS', sourceExecName), join(contents, 'MacOS', EXEC_NAME))
    }

    buildIcns(request.iconPngBase64, join(resourcesDir, 'icon.icns'))

    const plutil = (key: string, value: string): void => {
      execFileSync('plutil', ['-replace', key, '-string', value, plistPath], { stdio: 'ignore' })
    }
    plutil('CFBundleExecutable', EXEC_NAME)
    plutil('CFBundleIdentifier', `com.contextworkspace.client.${request.contextId}`)
    plutil('CFBundleName', safeName)
    plutil('CFBundleDisplayName', safeName)
    plutil('CFBundleIconFile', 'icon.icns')

    execFileSync('codesign', ['--force', '--sign', '-', bundle], { stdio: 'ignore' })

    return { ok: true, path: bundle }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 1024px PNG → .icns via the stock macOS sips + iconutil tools. */
function buildIcns(pngBase64: string, outIcns: string): void {
  const tmp = join(app.getPath('temp'), `cw-icon-${Date.now()}`)
  const iconset = join(tmp, 'icon.iconset')
  mkdirSync(iconset, { recursive: true })
  try {
    const base = join(tmp, 'base.png')
    writeFileSync(base, Buffer.from(pngBase64, 'base64'))
    const sizes: [string, number][] = [
      ['16x16', 16],
      ['16x16@2x', 32],
      ['32x32', 32],
      ['32x32@2x', 64],
      ['128x128', 128],
      ['128x128@2x', 256],
      ['256x256', 256],
      ['256x256@2x', 512],
      ['512x512', 512],
      ['512x512@2x', 1024]
    ]
    for (const [label, px] of sizes) {
      execFileSync(
        'sips',
        ['-z', String(px), String(px), base, '--out', join(iconset, `icon_${label}.png`)],
        { stdio: 'ignore' }
      )
    }
    execFileSync('iconutil', ['-c', 'icns', '-o', outIcns, iconset], { stdio: 'ignore' })
    if (!existsSync(outIcns)) throw new Error('icon conversion failed')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
