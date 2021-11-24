import {Vulnerability, BuildAction} from './types'
import {NotificationError} from './error'
import * as slack from './slack'
import * as s3 from './s3'

export function notifyVulnerability(
  imageName: string,
  vulnerabilities: Vulnerability[],
  rowJson: string,
  slackChannelId: string
): void {
  try {
    // Notify Slack
    for (const result of vulnerabilities) {
      if (result.Vulnerabilities != null) {
        for (const vulnerability of result.Vulnerabilities) {
          slack.postVulnerability(
            imageName,
            result.Target,
            vulnerability,
            slackChannelId
          )
        }
      }
    }

    // Upload to S3
    s3.uploadVulnerability(rowJson)
    return
  } catch (e) {
    throw new NotificationError(e)
  }
}

/*
 *
 */
export async function notifyBuildFailed(build: BuildAction): Promise<void> {
  slack.postBuildFailed(build)
}

export async function notifyReadyToDeploy(
  build: BuildAction,
  imageName: string,
  buildTime: string,
  tags: string | undefined
): Promise<void> {
  slack.postReadyToDeploy(build, imageName, buildTime, tags)
}
