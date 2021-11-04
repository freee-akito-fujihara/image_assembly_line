import Docker from '../src/docker'
import * as dockerUtil from '../src/docker-util'
import * as exec from '@actions/exec'

const commitHash = '869e3295e921af04e150efb1521d318ce99e353c'

describe('constructor', () => {
  test('registry and imageName, commitHash are given', async () => {
    const docker = new Docker(
      '1234567890.dkr.ecr.ap-northeast-1.amazonaws.com',
      'imagename/app',
      commitHash
    )
    expect(docker).toBeInstanceOf(Docker)
  })

  test('registry is empty', () => {
    expect(() => {
      new Docker('', 'imagename/app', commitHash)
    }).toThrowError()
  })
})

describe('Docker#build()', () => {
  const docker = new Docker(
    '1234567890.dkr.ecr.ap-northeast-1.amazonaws.com/',
    'imagename/app',
    commitHash
  )

  test('build', async () => {
    jest.spyOn(dockerUtil, 'latestBuiltImage').mockResolvedValueOnce({
      imageID: '1234567890',
      imageName: 'build-image/debug',
      tags: ['latest']
    })
    const result = await docker.build('build', true)
    expect(result).toEqual({
      imageID: '1234567890',
      imageName: 'build-image/debug',
      tags: ['latest', commitHash]
    })
  })
})

describe('Docker#tag()', () => {
  const docker = new Docker(
    '1234567890.dkr.ecr.ap-northeast-1.amazonaws.com/',
    'imagename/app',
    commitHash
  )

  test('tag', async () => {
    jest.spyOn(dockerUtil, 'latestBuiltImage').mockResolvedValueOnce({
      imageID: '1234567890',
      imageName: 'build-image/debug',
      tags: ['latest']
    })
    await docker.testUpdate()

    await expect(
      docker.tag('test', docker.upstreamRepository())
    ).rejects.toThrowError()
  })
})

describe('Docker#scan()', () => {
  const docker = new Docker(
    '1234567890.dkr.ecr.ap-northeast-1.amazonaws.com/',
    'imagename/app',
    commitHash
  )

  beforeAll(async () => {
    jest.spyOn(dockerUtil, 'latestBuiltImage').mockResolvedValueOnce({
      imageID: '1234567890',
      imageName: 'build-image/debug',
      tags: ['latest']
    })
    await docker.build('build', true)
  })

  test('scan passed', async () => {
    jest.spyOn(exec, 'exec').mockResolvedValueOnce(0)
    const result = await docker.scan('CRITICAL', '0', 'os')
    expect(result).toEqual(0)
  })

  test('scan passed', async () => {
    jest.spyOn(exec, 'exec').mockResolvedValueOnce(0)
    const result = await docker.scan('HIGH', '0', 'os')
    expect(result).toEqual(0)
  })

  test('scan failed', async () => {
    jest.spyOn(exec, 'exec').mockResolvedValueOnce(1)
    const result = await docker.scan('CRITICAL', '1', 'os')
    expect(result).toEqual(1)
  })
})
