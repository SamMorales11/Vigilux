import { env } from './config/index.js';
import { db, closeDatabaseConnection } from './db/index.js';
import { UserRepository, UserService, HealthService } from './modules/index.js';

export interface AppContext {
  userRepository: UserRepository;
  userService: UserService;
  healthService: HealthService;
}

export async function bootstrap(): Promise<AppContext> {
  console.log('====================================================');
  console.log(`🚀 Vigilux Server starting in [${env.NODE_ENV}] mode`);
  console.log(`📡 Port: ${env.PORT}`);
  console.log('====================================================');

  // Initialize domain modules via Dependency Injection (Clean Architecture)
  const userRepository = new UserRepository(db);
  const userService = new UserService(userRepository);
  const healthService = new HealthService();

  console.log('📦 Initialized Clean Architecture modules:');
  console.log('   - UserService & UserRepository (Drizzle ORM)');
  console.log('   - HealthService');

  // Verify health status
  const health = await healthService.check();
  console.log(`🩺 Health check status: [${health.status.toUpperCase()}]`);
  console.log(`   Database connection: [${health.services.database.toUpperCase()}]`);

  // Handle graceful shutdowns
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Closing database connection...`);
    await closeDatabaseConnection();
    console.log('👋 Vigilux Server gracefully terminated.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('✨ Vigilux Server initialization completed successfully.');

  return {
    userRepository,
    userService,
    healthService,
  };
}

bootstrap().catch((error: unknown) => {
  console.error('❌ Fatal error during bootstrap:', error);
  process.exit(1);
});
