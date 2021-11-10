import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as im from '@actions/exec/lib/interfaces'
import {latestBuiltImage, dockerImageTag, pushDockerImage} from './docker-util'
import {BuildError, ScanError, PushError, TaggingError} from './error'
import {Vulnerability} from './types'
import {notifyVulnerability} from './notification'
import {Buffer} from 'buffer'
import {base64} from './base64'

export default class Docker {
  private readonly registry: string
  private readonly imageName: string
  private readonly commitHash: string
  private _builtImage?: DockerImage

  constructor(registry: string, imageName: string, commitHash: string) {
    if (!registry) {
      throw new Error('registry is empty')
    }
    if (!imageName) {
      throw new Error('imageName is empty')
    }

    // remove the last '/'
    this.registry = sanitizedDomain(registry)
    this.imageName = imageName
    this.commitHash = commitHash
  }

  get builtImage(): DockerImage | undefined {
    return this._builtImage
  }

  async build(target: string, noPush: boolean): Promise<DockerImage> {
    if (!noPush) {
      await this.loginRegistery()
    }
    try {
      core.info(`[Build] Registry name: ${this.registry}`)
      core.info(`[Build] Image name: ${this.imageName}`)
      const execParams = [target, `IMAGE_NAME=${this.imageName}`]

      if (!noPush) {
        execParams.push(`REGISTRY_NAME=${this.registry}`)
      }

      await exec.exec('make', execParams)

      return this.update()
    } catch (e) {
      core.debug('build() error')
      throw new BuildError(e)
    }
  }

  async scan(
    severityLevel: string,
    scanExitCode: string,
    trivyVulnType: string,
    notifyTrivyAlert: string
  ): Promise<number> {
    try {
      if (!this._builtImage) {
        throw new Error('No built image to scan')
      }

      if (!severityLevel.includes('CRITICAL')) {
        severityLevel = `CRITICAL,${severityLevel}`
      }

      let trivyScanReport = '[]'
      const options: im.ExecOptions = {
        silent: true,
        listeners: {
          stdout: (data: Buffer) => {
            trivyScanReport = data.toString()
          }
        }
      }

      const imageName = `${this._builtImage.imageName}:${this._builtImage.tags[0]}`
      core.info(`[Scan] Image name: ${imageName}`)
      const skipDirs = '/usr/local/rvm/gems' // comma separated
      const result = await exec.exec(
        'trivy',
        [
          '--light',
          '--no-progress',
          '--quiet',
          '--format',
          'json',
          '--exit-code',
          scanExitCode,
          '--severity',
          severityLevel,
          '--vuln-type',
          trivyVulnType,
          '--skip-dirs',
          skipDirs,
          '--ignore-unfixed',
          imageName
        ],
        options
      )

      let trivyJsonScanReport: Vulnerability[]
      try {
        trivyJsonScanReport = JSON.parse(trivyScanReport)
      } catch (e) {
        core.info(`[Scan Report]: ${trivyScanReport}`)
        throw new Error('Invalid JSON')
      }

      const vulnerabilities: Vulnerability[] = trivyJsonScanReport
      if (notifyTrivyAlert === 'true' && vulnerabilities.length > 0) {
        notifyVulnerability(imageName, vulnerabilities, trivyScanReport)
      }

      return result
    } catch (e) {
      core.error('scan() error')
      throw new ScanError(e)
    }
  }

  private async getEcrPass(): Promise<string> {
    let ecrLoginPass = ''
    let ecrLoginError = ''
    const options: im.ExecOptions = {
      // set silent, not to log the password
      silent: true,
      listeners: {
        stdout: (data: Buffer) => {
          ecrLoginPass += data.toString()
        },
        stderr: (data: Buffer) => {
          ecrLoginError += data.toString()
        }
      }
    }

    try {
      await exec.exec('aws', ['ecr', 'get-login-password'], options)
      return ecrLoginPass
    } catch (e) {
      core.error(ecrLoginError.trim())
      throw e
    }
  }

  private async xRegistryAuth(): Promise<string> {
    const ecrLoginPass = await this.getEcrPass()
    const auth = JSON.stringify({
      username: 'AWS',
      password: ecrLoginPass,
      email: 'none',
      serveraddress: this.registry
    })
    return base64.encode(auth)
  }

  private async loginRegistery(): Promise<void> {
    const loginOptions: im.ExecOptions = {
      // set silent, not to log the password
      silent: true
    }
    try {
      const ecrLoginPass = await this.getEcrPass()
      await exec.exec(
        'docker',
        [
          'login',
          '-u',
          'AWS',
          '-p',
          `${ecrLoginPass}`,
          `https://${this.registry}`
        ],
        loginOptions
      )
    } catch (e) {
      core.error('loginRegistery() error')
      throw e
    }
  }

  async tag(tag: string, upstreamRegistry: string): Promise<void> {
    if (!this._builtImage) {
      throw new Error('No built image to tag')
    }

    core.info(`[Tag] Image ID: ${this._builtImage.imageID}`)
    core.info(`[Tag] Tag to add: ${tag}`)
    await dockerImageTag(this._builtImage.imageID, upstreamRegistry, tag).catch(
      e => {
        core.error('tag() error on dockerImageTag')
        throw new TaggingError(e)
      }
    )
  }

  async push(tag: string, upstreamRegistry: string): Promise<void> {
    if (!this._builtImage) {
      throw new Error('No built image to push')
    }

    const registryAuth = await this.xRegistryAuth()
    core.info(`[Push] Upstream registry: ${upstreamRegistry}`)
    core.info(`[Push] Tag: ${tag}`)

    await pushDockerImage(upstreamRegistry, tag, registryAuth).catch(e => {
      core.error('push() error on pushDockerImage')
      throw new PushError(e)
    })
  }

  upstreamRepository(): string {
    if (this._builtImage) {
      return `${this.registry}/${this._builtImage.imageName}`
    } else {
      throw new Error('No image built')
    }
  }

  private async update(): Promise<DockerImage> {
    this._builtImage = await latestBuiltImage(this.imageName)
    this._builtImage.tags.push(this.commitHash)
    core.debug(JSON.stringify(this._builtImage))
    return this._builtImage
  }

  // function for test
  async testUpdate(): Promise<DockerImage | void> {
    if (process.env.NODE_ENV === 'test') {
      return this.update()
    }
  }
}

function sanitizedDomain(str: string): string {
  return str.endsWith('/') ? str.substr(0, str.length - 1) : str
}

export interface DockerImage {
  imageID: string
  imageName: string
  tags: string[]
}
