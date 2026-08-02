import { UserService } from "./user.service";
import type { User, CreateUserDto } from "./user.service";

/**
 * User controller — HTTP layer.
 * Should be detected as CONTROLLER (naming convention).
 * Calls UserService.findById and UserService.createUser.
 */
export class UserController {
  constructor(private readonly userService: UserService) {}

  async getUser(id: string): Promise<User | null> {
    return this.userService.findById(id);
  }

  async createUser(data: CreateUserDto): Promise<User> {
    return this.userService.createUser(data);
  }
}
