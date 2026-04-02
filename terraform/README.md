# Terraform

Cloudflare リソース（D1, R2 等）を Terraform で管理する。

## 管理リソース

| リソース | 用途 |
|---|---|
| `cloudflare_d1_database.main` | アプリ用 D1 データベース |
| `cloudflare_r2_bucket.tfstate` | Terraform state 保存用 R2 バケット |

## State 管理

tfstate は Cloudflare R2（S3 互換）にリモート保存される。ローカルには保持しない。

## ライフサイクル

```
terraform/** を変更して PR 作成
  ↓
GitHub Actions が terraform plan を実行し、PR にコメント投稿
  ↓
レビュー・マージ
  ↓
GitHub Actions が terraform apply を自動実行
```

- plan / apply は `concurrency` で直列化されており、同時実行されない
- 手動で `terraform apply` を実行する必要は基本的にない

## ローカルセットアップ

### 1. Cloudflare API トークンを取得

Cloudflare ダッシュボード > My Profile > API Tokens でトークンを発行する。
以下の権限が必要：

- Account > D1 > Edit
- Account > Workers R2 Storage > Edit

### 2. R2 API トークンを取得

Cloudflare ダッシュボード > R2 > API トークン管理 で S3 互換の API トークンを発行する。
発行後に表示される Access Key ID と Secret Access Key を控える。

### 3. 認証ファイルを作成

```bash
# terraform ディレクトリに移動
cd terraform

# backend.hcl を作成（R2 接続情報）
cp backend.hcl.example backend.hcl
```

`backend.hcl` を編集し、以下の値を埋める：

```hcl
endpoints = {
  s3 = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
}
access_key = "<R2_ACCESS_KEY_ID>"
secret_key = "<R2_SECRET_ACCESS_KEY>"
```

```bash
# terraform.tfvars を作成（Terraform 変数）
cat <<'EOF' > terraform.tfvars
account_id = "<CLOUDFLARE_ACCOUNT_ID>"
EOF
```

### 4. 環境変数を設定

```bash
export CLOUDFLARE_API_TOKEN="<YOUR_API_TOKEN>"
```

### 5. Terraform を初期化

```bash
terraform init -backend-config=backend.hcl
```

`Successfully configured the backend "s3"!` と表示されれば成功。

## 認証情報まとめ

| 認証情報 | 用途 | 設定方法 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API 認証 | `export` で環境変数に設定 |
| `backend.hcl` | R2 接続情報 | `backend.hcl.example` をコピーして編集 |
| `terraform.tfvars` | `account_id` 等の変数 | 手動作成 |

`backend.hcl` と `terraform.tfvars` は `.gitignore` で除外済み。
