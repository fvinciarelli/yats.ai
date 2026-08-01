<?php

/**
 * User service — core business logic.
 * Should be detected as SERVICE (Symfony convention).
 */
class UserService
{
    private UserRepository $userRepository;
    private MailerInterface $mailer;

    public function __construct(UserRepository $userRepository, MailerInterface $mailer)
    {
        $this->userRepository = $userRepository;
        $this->mailer = $mailer;
    }

    /**
     * Find a user by their ID.
     */
    public function findById(string $id): ?User
    {
        $user = $this->userRepository->findOne($id);
        if (!$user) {
            throw new \RuntimeException("User {$id} not found");
        }
        return $user;
    }

    /**
     * Create a new user and send welcome email.
     */
    public function createUser(string $email, string $name): User
    {
        $user = new User();
        $user->setEmail($email);
        $user->setName($name);
        $this->userRepository->save($user);
        $this->mailer->sendWelcome($user);
        return $user;
    }
}

class User
{
    private string $id;
    private string $email;
    private string $name;

    public function getEmail(): string { return $this->email; }
    public function setEmail(string $email): void { $this->email = $email; }
    public function getName(): string { return $this->name; }
    public function setName(string $name): void { $this->name = $name; }
}

interface UserRepository
{
    public function findOne(string $id): ?User;
    public function save(User $user): void;
}

interface MailerInterface
{
    public function sendWelcome(User $user): void;
}
