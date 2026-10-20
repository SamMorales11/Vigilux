import type { IUserRepository } from './user.repository.interface.js';
import { createUserSchema, type CreateUserInput } from './user.entity.js';
import type { User } from '../../db/schema.js';

export class UserService {
  constructor(private readonly userRepository: IUserRepository) {}

  async registerUser(input: CreateUserInput): Promise<User> {
    const validated = createUserSchema.parse(input);
    const existing = await this.userRepository.findByEmail(validated.email);
    if (existing) {
      throw new Error(`User with email '${validated.email}' already exists.`);
    }

    return this.userRepository.create({
      email: validated.email,
      name: validated.name,
    });
  }

  async getUserById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new Error(`User with id '${id}' not found.`);
    }
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return this.userRepository.findAll();
  }
}
