import { SECRET } from "./secret"
import { domain } from "./stage"

const storage = new sst.cloudflare.Bucket("EnterpriseStorage")

const enterprise = new sst.cloudflare.x.SolidStart("Enterprise", {
  domain: "enterprise." + domain,
  path: "packages/enterprise",
  buildCommand: "bun run build:cloudflare",
  environment: {
    OCODE_STORAGE_ADAPTER: "r2",
    OCODE_STORAGE_ACCOUNT_ID: sst.cloudflare.DEFAULT_ACCOUNT_ID,
    OCODE_STORAGE_ACCESS_KEY_ID: SECRET.R2AccessKey.value,
    OCODE_STORAGE_SECRET_ACCESS_KEY: SECRET.R2SecretKey.value,
    OCODE_STORAGE_BUCKET: storage.name,
  },
})
