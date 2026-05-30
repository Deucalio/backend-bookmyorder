const { PrismaClient } = require('@prisma/client');

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global._prismaClient) {
    global._prismaClient = new PrismaClient();
  }
  prisma = global._prismaClient;
}

module.exports = prisma;
