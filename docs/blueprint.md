# **App Name**: InnWise

## Core Features:

- Login Form: Simple login page with username and password fields.
- Authentication: Authenticate user against the provided Postgresql database using username and password.
- Update Login Timestamp: On successful login, update the `last_log_in` timestamp in the database.
- Role-Based Redirection: Redirect to the appropriate dashboard (admin, sysad, staff) based on the user's `role` in the database.

## Style Guidelines:

- Primary color: Deep blue (#3F51B5) to convey trust and security, as appropriate for an authentication system.
- Background color: Light gray (#F5F5F5), nearly white but providing subtle contrast to the login form.
- Accent color: Light blue (#64B5F6), to complement the primary color and draw attention to interactive elements such as buttons.
- Clear, sans-serif font for all text elements to ensure readability.
- Clean and centered layout for the login form to focus the user's attention.
- Subtle animations on form elements to indicate focus and interaction.