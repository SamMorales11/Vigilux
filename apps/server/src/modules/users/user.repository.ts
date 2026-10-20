import { eq } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { users, type User, type NewUser } from '../../db/schema.js';
import type { IUserRepository } from './user.repository.interface.js';

export class UserRepository implements IUserRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<User | null> {
    const result = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0] ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0] ?? null;
  }

  async create(data: NewUser): Promise<User> {
    const result = await this.db.insert(users).values(data).returning();
    const created = result[0];
    if (!created) {
      throw new Error('Failed to create user record.');
    }
    return created;
  }

  async findAll(): Promise<User[]> {
    return this.db.select().from(users);
  }
}
