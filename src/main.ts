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

async function run(): Promise<void> {
  try {
    const image = core.getInput('image')
    const configFile = core.getInput('config-file')

    const diveRepo = core.getInput('dive-image-registry')
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
