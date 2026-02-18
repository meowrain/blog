import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'blog-admin-backend',
      version: this.getVersion(),
      status: 'running',
    };
  }

  getVersion(): string {
    return process.env.npm_package_version ?? '0.0.1';
  }
}
