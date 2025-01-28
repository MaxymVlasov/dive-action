import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import stripAnsi from 'strip-ansi'
import fs from 'fs'
import * as en from './locales/en.json'

function format(output: string): string {
  const ret = [en.inefficientFiles]
  let summarySection = false
  let inefficientFilesSection = false
  let resultSection = false

  for (const line of output.split('\n')) {
    if (line.includes(en.analyzingImage)) {
      summarySection = true
      inefficientFilesSection = false
      resultSection = false
      ret.push(en.summary)
    } else if (line.includes(en.inefficientFilesHeader)) {
      summarySection = false
      inefficientFilesSection = true
      resultSection = false
      ret.push(en.inefficientFilesSection)
    } else if (line.includes(en.resultsHeader)) {
      summarySection = false
      inefficientFilesSection = false
      resultSection = true
      ret.push(en.results)
    } else if (summarySection || resultSection) {
      ret.push(stripAnsi(line))
    } else if (inefficientFilesSection) {
      if (line.startsWith(en.countHeaderPrefix)) {
        ret.push(en.countHeader)
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
    const imageSource = core.getInput('image-source')
    const allowedSources = ['docker', 'docker-archive', 'podman']
    if (!allowedSources.includes(imageSource)) {
      throw new Error(
        `Invalid image-source. Allowed values are: ${allowedSources.join(', ')}`
      )
    }

    const configFile = core.getInput('config-file')

    const diveRepo = core.getInput('dive-image-registry')
    // Validate Docker image name format
    if (!/^[\w.\-_/]+$/.test(diveRepo)) {
      throw new Error('Invalid dive-image-registry format')
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
    if (hasConfigFile) {
      commandOptions.push(
        '--mount',
        `type=bind,source=${configFile},target=/.dive-ci`
      )
    }

    const parameters = [
      'run',
      ...commandOptions,
      diveImage,
      image,
      '--source',
      imageSource
    ]
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
    if (exitCode === 0) {
      // success
      return
    }

    const token = core.getInput('github-token')
    if (!token) {
      core.setFailed(
        `${en.scanFailed} (exit code: ${exitCode}). To post scan results ` +
          'as a PR comment, please provide the github-token in the action inputs.'
      )
      return
    }
    const octokit = github.getOctokit(token)
    const comment = {
      ...github.context.issue,
      issue_number: github.context.issue.number,
      body: format(output)
    }
    await octokit.rest.issues.createComment(comment)
    core.setFailed(`${en.scanFailed} (exit code: ${exitCode})`)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

run()
