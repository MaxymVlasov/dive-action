/* eslint-disable i18n-text/no-en */
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import stripAnsi from 'strip-ansi'
import fs from 'fs'

function format(output: string): string {
  const ret = ['**The container image has inefficient files.**']
  let summarySection = false
  let inefficientFilesSection = false
  let resultSection = false

  for (const line of output.split('\n')) {
    if (line.includes('Analyzing image')) {
      summarySection = true
      inefficientFilesSection = false
      resultSection = false
      ret.push('### Summary')
    } else if (line.includes('Inefficient Files:')) {
      summarySection = false
      inefficientFilesSection = true
      resultSection = false
      ret.push('### Inefficient Files')
    } else if (line.includes('Results:')) {
      summarySection = false
      inefficientFilesSection = false
      resultSection = true
      ret.push('### Results')
    } else if (summarySection || resultSection) {
      ret.push(stripAnsi(line))
    } else if (inefficientFilesSection) {
      if (line.startsWith('Count')) {
        ret.push('| Count | Wasted Space | File Path |')
        ret.push('|---|---|---|')
      } else {
        // https://github.com/joschi/dive/blob/v0.12.0/runtime/ci/evaluator.go#L138
        ret.push(
          `| ${line.slice(0, 5)} | ${line.slice(7, 19)} | ${line.slice(21)} |`
        )
      }
    }
  }
  return ret.join('\n')
}

function error(message: string): void {
  core.setOutput('error', message)
  core.setFailed(message)
  process.exit(1)
}

async function postComment(token: string, output: string): Promise<void> {
  const octokit = github.getOctokit(token)
  const comment = {
    ...github.context.issue,
    issue_number: github.context.issue.number,
    body: format(output)
  }
  await octokit.rest.issues.createComment(comment)
}

/**
 * Executes a Docker image analysis using the dive tool and handles the results.
 *
 * @remarks
 * This async function performs the following key steps:
 * - Pulls the specified dive tool Docker image
 * - Runs dive analysis on a target Docker image
 * - Handles different exit scenarios, including posting comments on GitHub issues
 *
 * @throws {Error} Fails the GitHub Action if analysis encounters issues or lacks required configuration
 *
 * @returns A promise that resolves when the analysis is complete
 *
 * @beta
 */
async function run(): Promise<void> {
  try {
    const image = core.getInput('image')
    if (!image) {
      error('Missing required parameter: image')
    }
    const configFile = core.getInput('config-file')
    // Convert always-comment input to boolean value.
    // All values other than 'true' are considered false.
    const alwaysComment =
      core.getInput('always-comment').toLowerCase() === 'true'
    const token = core.getInput('github-token')

    if (alwaysComment && !token) {
      error('"always-comment" parameter requires "github-token" to be set.')
    }

    const diveRepo = core.getInput('dive-image-registry')
    // Validate Docker image name format
    if (!/^[\w.\-_/]+$/.test(diveRepo)) {
      error('Invalid dive-image-registry format')
    }
    const diveVersion = core.getInput('dive-image-version')
    const diveImage = `${diveRepo}:${diveVersion}`
    await exec.exec('docker', ['pull', diveImage])

    const commandOptions = [
      '-e',
      'CI=true',
      '-e',
      'DOCKER_API_VERSION=1.45',
      '--rm',
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock'
    ]

    const hasConfigFile = fs.existsSync(configFile)
    const configFileDefaultPath = `${process.env.GITHUB_WORKSPACE}/.dive.yaml`
    if (!hasConfigFile && configFile !== configFileDefaultPath) {
      error(
        `Config file not found in the specified path '${configFile}'\n` +
          `github.workspace value is: '${process.env.GITHUB_WORKSPACE}'`
      )
    }

    if (hasConfigFile) {
      commandOptions.push(
        '--mount',
        `type=bind,source=${configFile},target=/.dive-ci`
      )
    }

    const parameters = ['run', ...commandOptions, diveImage, image]
    if (hasConfigFile) {
      parameters.push('--ci-config', '/.dive-ci')
    }
    let output = ''
    const execOptions = {
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString()
        },
        stderr: (data: Buffer) => {
          output += data.toString()
        }
      }
    }
    const exitCode = await exec.exec('docker', parameters, execOptions)

    const scanFailedErrorMsg = `Scan failed (exit code: ${exitCode})`

    if (alwaysComment) {
      await postComment(token, output)

      if (exitCode === 0) return

      error(scanFailedErrorMsg)
    }

    if (exitCode === 0) return

    if (!token) {
      error(
        `Scan failed (exit code: ${exitCode}).\nTo post scan results as ` +
          'a PR comment, please provide the github-token in the action inputs.'
      )
    }

    await postComment(token, output)

    error(scanFailedErrorMsg)
  } catch (e) {
    error(e instanceof Error ? e.message : String(e))
  }
}

run()
