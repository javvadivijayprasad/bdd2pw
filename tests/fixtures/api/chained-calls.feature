Feature: Chained API calls

  @api
  Scenario: Login then fetch the current user
    When I send a POST request to "/api/auth/login" with body:
      """
      { "username": "student", "password": "Password123" }
      """
    Then the response status is 200
    When I send a GET request to "/api/users/me" with header "Authorization" set to "Bearer hardcoded-test-token"
    Then the response status is 200
    And the response body field "username" equals "student"
