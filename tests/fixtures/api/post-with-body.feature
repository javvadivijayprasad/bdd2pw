Feature: POST with JSON body

  @api
  Scenario: Successful login via API returns a token
    When I send a POST request to "/api/auth/login" with body:
      """
      { "username": "student", "password": "Password123" }
      """
    Then the response status is 200
    And the response body has a non-empty "token" field
