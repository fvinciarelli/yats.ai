package handler

import "errors"

// User represents a user in the system.
type User struct {
	ID    string
	Email string
	Name  string
}

// UserService handles user business logic.
type UserService struct {
	repo   UserRepository
	mailer Mailer
}

// FindByID looks up a user by ID.
func (s *UserService) FindByID(id string) (*User, error) {
	user, err := s.repo.FindOne(id)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, errors.New("user not found")
	}
	return user, nil
}

// CreateUser creates a user and sends a welcome email.
func (s *UserService) CreateUser(email, name string) (*User, error) {
	user := &User{Email: email, Name: name}
	if err := s.repo.Save(user); err != nil {
		return nil, err
	}
	s.mailer.SendWelcome(user)
	return user, nil
}

// UserRepository defines the data access interface.
type UserRepository interface {
	FindOne(id string) (*User, error)
	Save(user *User) error
}

// Mailer defines the email interface.
type Mailer interface {
	SendWelcome(user *User) error
}
