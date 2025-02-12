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
}

/**
 * Orchestrates a Docker image analysis using the dive tool.
 *
 * This async function retrieves input parameters for the GitHub Action, including:
 * - "image": The target Docker image for analysis (required).
 * - "config-file": The path to a dive configuration file.
 * - "dive-image-registry": The Docker registry for the dive tool (must match /^[\w.\-_/]+$/).
 * - "dive-image-version": The tag/version for the dive tool image.
 * - "github-token": (Optional) A token used to post the scan results as a GitHub issue comment.
 *
 * The function validates these inputs, pulls the corresponding dive tool Docker image, and constructs
 * the command options for running the dive analysis. If a configuration file exists at the specified
 * path, it is mounted during execution. The dive command is then executed using Docker, and its output
 * is captured.
 *
 * If the analysis completes successfully (exit code 0), the function exits. If the analysis fails:
 * - When a valid GitHub token is provided, the formatted output is posted as a comment on the related
 *   GitHub issue.
 * - If no token is provided, an error message is logged, indicating the need for a token to post results.
 *
 * Any error or exception encountered during these steps, including missing required inputs or invalid
 * configuration formats, results in the GitHub Action being marked as failed.
 *
 * @throws Error When required inputs are missing, the dive image registry format is invalid, or any
 *         errors occur during the analysis execution.
 *
 * @returns A promise that resolves when the analysis and related error handling are complete.
 *
 * @beta
 */
async function run(): Promise<void> {
  try {
    const image = core.getInput('image')
    if (!image) {
      error('Missing required parameter: image')
      return
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
    if (exitCode === 0) {
      // success
      return
    }

    const token = core.getInput('github-token')
    if (!token) {
      error(
        `Scan failed (exit code: ${exitCode}).\nTo post scan results ` +
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
    error(`Scan failed (exit code: ${exitCode})`)
  } catch (e) {
    error(e instanceof Error ? e.message : String(e))
  }
}

run()
