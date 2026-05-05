Feature: R-8BE659B5-001

  # Real-world LLM-generated Gherkin from a test-case-generation-service run
  # (job j-20f3defc3044f7ec, exported 2026-05-05). Locked as a regression
  # fixture so future changes can never silently break the LLM dialect.
  #
  # Notable patterns covered:
  #   - "Navigate to <URL>"  (no subject prefix)
  #   - "Locate the X (input)? field and enter 'V'"  (compound: locate + fill)
  #   - "Click the 'X' button"  (quoted name + role)
  #   - "Leave the X field empty (do not type anything)"  (intentional skip)
  #   - "Observe ..." / "Note ..."  (annotation noise — emit comment)
  #   - "User is redirected to ... (URL contains 'X')"  (parenthetical hint, v1.0.1)
  #   - "URL does not change to the success page"  (negative URL assertion)
  #   - "Page displays a ... message such as 'V'"  (such-as text-contains)
  #   - "An error message is displayed (e.g., 'V')"  (parenthetical text-contains)
  #   - "A 'X' button is visible on the page"  (visibility, no subject)
  #   - "No 'X' button appears"  (negative visibility, quoted name)
  #   - "No error messages are displayed"  (negative visibility, plural)
  #   - "User remains on the login page"  (URL stays, v1.0.0 rule 10)

  Scenario: TC-001 Successful login with valid credentials
    When Navigate to https://practicetestautomation.com/practice-test-login/
    When Locate the username input field and enter 'student'
    When Locate the password input field and enter 'Password123'
    When Click the 'Submit' button
    When Observe the resulting page and URL
    Then User is redirected to the logged-in success page (URL contains 'practice-test-login/logged-in-successfully')
    Then Page displays a congratulatory success message such as 'Congratulations student. You successfully logged in!'
    Then A 'Log out' button is visible on the page
    Then No error messages are displayed

  Scenario: TC-002 Login fails with invalid username and password
    When Navigate to https://practicetestautomation.com/practice-test-login/
    When Locate the username input field and enter 'invalidUser'
    When Locate the password input field and enter 'wrongPassword'
    When Click the 'Submit' button
    When Observe the error message displayed on the page
    Then User remains on the login page
    Then An error message is displayed indicating invalid credentials (e.g., 'Your username is invalid!')
    Then URL does not change to the success page
    Then No success message is shown
    Then No 'Log out' button appears

  Scenario: TC-003 Login fails when username and password fields are empty (boundary empty input)
    When Navigate to https://practicetestautomation.com/practice-test-login/
    When Leave the username input field empty (do not type anything)
    When Leave the password input field empty (do not type anything)
    When Click the 'Submit' button
    When Observe the page response and any validation messages
    Then User remains on the login page
    Then An error or validation message is displayed indicating that credentials are required or invalid
    Then URL does not change to the success page
    Then No success message is shown
    Then No 'Log out' button appears

  Scenario: TC-004 Login fails with valid username but incorrect password
    When Navigate to https://practicetestautomation.com/practice-test-login/
    When Locate the username input field and enter 'student'
    When Locate the password input field and enter 'WrongPass999'
    When Click the 'Submit' button
    When Observe the error message displayed on the page
    Then User remains on the login page
    Then An error message is displayed (e.g., 'Your password is invalid!')
    Then URL does not change to the success page
    Then No success or congratulations message is shown
    Then No 'Log out' button appears
