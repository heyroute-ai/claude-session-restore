# 发布流程(维护者)

日常发版只需两条命令,其余全自动:

```bash
npm version patch   # 或 minor / major:改 package.json + 提交 + 打 v* tag
git push --follow-tags
```

tag 推上去后 [release.yml](.github/workflows/release.yml) 自动:校验 tag 与 package.json 版本一致 → 跑测试 → 通过 npm **Trusted Publishing**(GitHub Actions OIDC)发布,全程无任何存储的 token,并自动附带 provenance 证明。

## 一次性初始化(只做一次)

1. **首版发布**(trusted publisher 需要包先存在):本机登录并发布——

   ```bash
   npm login          # 浏览器完成
   npm publish --access public
   ```

2. **配置 Trusted Publisher**:npmjs.com → 包 `claude-session-restore` → Settings → Trusted Publisher → GitHub Actions,填:
   - Organization or user: `heyroute-ai`
   - Repository: `claude-session-restore`
   - Workflow filename: `release.yml`
   - Environment: 留空

3. 之后所有版本都走开头的两条命令。建议顺手在包设置里把 publishing access 设为 *Require two-factor authentication or a trusted publisher*,禁掉裸 token 发布。

## 备选:token 方案(不推荐,但首版也想走 CI 时可用)

npmjs.com 生成 **Granular Access Token**(仅此包、Read and write、设过期时间)→ 自己添加到 GitHub 仓库 Settings → Secrets and variables → Actions,名为 `NPM_TOKEN`(不要把 token 交给任何人或粘贴到聊天/issue 里)→ 在 release.yml 的 publish 步骤加:

```yaml
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

配置 Trusted Publisher 后应删除该 secret 并撤销 token。
