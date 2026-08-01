import { UserRepository } from "./user.repository";
import { Mailer } from "./mailer";

export class NotFoundException extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export class CreateUserDto {
  email: string;
  name: string;
}

/**
 * User service — core business logic.
 * Should be detected as SERVICE (naming convention).
 */
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly mailer: Mailer,
  ) {}

  /**
   * Find a user by their ID.
   */
  async findById(id: string): Promise<User | null> {
    const user = await this.userRepository.findOne(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  /**
   * Create a new user and send welcome email.
   */
  async createUser(data: CreateUserDto): Promise<User> {
    const user: User = {
      id: "",
      email: data.email,
      name: data.name,
    };
    const saved = await this.userRepository.save(user);
    await this.mailer.sendWelcome(saved);
    return saved;
  }
}
