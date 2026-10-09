process.env["NODE_ENV"] = "test";
process.env["DATABASE_URL"] ??= "postgresql://mashupkgrid:mashupkgrid@localhost:5432/mashupkgrid_isp_test?schema=public";
process.env["REDIS_URL"] ??= "redis://localhost:6379";
process.env["JWT_ACCESS_SECRET"] ??= "test-access-secret-0123456789-0123456789";
process.env["JWT_REFRESH_PEPPER"] ??= "test-refresh-pepper-0123456789-0123456789";
process.env["ENCRYPTION_KEY"] ??= "a".repeat(64);
