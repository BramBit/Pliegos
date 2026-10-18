import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  USER_REPOSITORY_PORT,
  UserRepositoryPort,
} from '../../domain/ports/user.repository.port';
import { hashPassword } from '../../infrastructure/security/password-hasher';

export interface RegisterInput {
  email: string;
  password: string;
}

export interface RegisterOutput {
  id: string;
  email: string;
}

@Injectable()
export class RegisterUseCase {
  constructor(
    @Inject(USER_REPOSITORY_PORT)
    private readonly userRepository: UserRepositoryPort,
  ) {}

  async execute(input: RegisterInput): Promise<RegisterOutput> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new BadRequestException('Email is already registered');
    }

    if (!input.password || input.password.length < 10) {
      throw new BadRequestException('Password must be at least 10 characters long');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.userRepository.create({
      email,
      passwordHash,
      role: 'user',
    });

    return {
      id: user.id,
      email: user.email,
    };
  }
}
