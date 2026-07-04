/**
 * Metro 설정 — Bun 워크스페이스 모노레포 지원
 *
 * @litechat/types 등 워크스페이스 패키지가 루트 node_modules로 호이스트되므로
 * watchFolders와 nodeModulesPaths를 명시해 해석을 결정적으로 만든다.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
