using System;
using System.Threading.Tasks;

namespace TestApp.Services;

/// <summary>
/// User service — core business logic.
/// Should be detected as SERVICE (ASP.NET convention).
/// </summary>
public class UserService
{
    private readonly IUserRepository _userRepository;
    private readonly IMailer _mailer;

    public UserService(IUserRepository userRepository, IMailer mailer)
    {
        _userRepository = userRepository;
        _mailer = mailer;
    }

    /// <summary>
    /// Find a user by their ID.
    /// </summary>
    public async Task<User?> FindByIdAsync(string id)
    {
        var user = await _userRepository.FindOneAsync(id);
        if (user == null)
        {
            throw new InvalidOperationException($"User {id} not found");
        }
        return user;
    }

    /// <summary>
    /// Create a new user and send welcome email.
    /// </summary>
    public async Task<User> CreateUserAsync(string email, string name)
    {
        var user = new User { Email = email, Name = name };
        await _userRepository.SaveAsync(user);
        await _mailer.SendWelcomeAsync(user);
        return user;
    }
}

public class User
{
    public string Id { get; set; } = "";
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
}

public interface IUserRepository
{
    Task<User?> FindOneAsync(string id);
    Task SaveAsync(User user);
}

public interface IMailer
{
    Task SendWelcomeAsync(User user);
}
