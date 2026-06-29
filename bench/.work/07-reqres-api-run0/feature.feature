Feature: Reqres API smoke

  Scenario: List users on page 2
    Given the base URL is "https://reqres.in"
    When I send a GET request to "/api/users?page=2"
    Then the response status code should be 200
    And the response body should have field "page" equal to 2
    And the response body should have field "data" as an array

  Scenario: Create a user
    Given the base URL is "https://reqres.in"
    When I send a POST request to "/api/users" with body:
      """
      { "name": "bench", "job": "qa" }
      """
    Then the response status code should be 201
    And the response body should have field "name" equal to "bench"
    And the response body should have field "id"

  Scenario: Delete a user returns 204
    Given the base URL is "https://reqres.in"
    When I send a DELETE request to "/api/users/2"
    Then the response status code should be 204
