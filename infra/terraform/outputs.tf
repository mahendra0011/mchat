output "media_bucket_name" {
  description = "S3 bucket holding media object storage (accessed only via scoped URLs)"
  value       = aws_s3_bucket.media.bucket
}

output "media_bucket_arn" {
  value = aws_s3_bucket.media.arn
}

output "db_endpoint" {
  description = "Authoritative Postgres endpoint"
  value       = aws_db_instance.orbit.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "Redis endpoint (job queue + realtime pub/sub)"
  value       = "${aws_elasticache_cluster.orbit.cache_nodes[0].address}:${aws_elasticache_cluster.orbit.cache_nodes[0].port}"
}

output "vpc_id" {
  value = aws_vpc.orbit.id
}

# Values consumed by the API deployment (inject as env vars):
#   DATABASE_URL       = "postgres://orbit:${var.db_master_password}@${aws_db_instance.orbit.endpoint}/orbit"
#   REDIS_URL          = "redis://${redis endpoint}"
#   ORBIT_MEDIA_SIGNING_SECRET = (secret manager value used to mint scoped URLs)
