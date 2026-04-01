#provider設定
terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {}

# D1 Database
resource "cloudflare_d1_database" "main" {
  account_id = var.account_id
  name       = var.d1_database_name
}

# Worker Script
# NOTE: content はアプリビルド後に設定する。現時点ではリソース定義のみ（apply対象外）
# resource "cloudflare_workers_script" "app" {
#   account_id  = var.account_id
#   script_name = var.worker_name
#   main_module = "index.js"
#   content     = file("${path.module}/../worker/dist/index.js")
#
#   compatibility_date  = "2024-09-23"
#   compatibility_flags = ["nodejs_compat"]
#
#   bindings = [
#     {
#       type = "d1"
#       name = "DB"
#       id   = cloudflare_d1_database.main.id
#     },
#     {
#       type       = "durable_object_namespace"
#       name       = "ORDER_UPDATES"
#       class_name = "OrderUpdatesDO"
#     }
#   ]
#
#   migrations = {
#     new_tag     = "v1"
#     new_classes = ["OrderUpdatesDO"]
#   }
# }
