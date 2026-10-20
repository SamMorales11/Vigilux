import type { User, NewUser } from '../../db/schema.js';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: NewUser): Promise<User>;
  findAll(): Promise<User[]>;
}
