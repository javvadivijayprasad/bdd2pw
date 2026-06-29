Feature: Conduit blog flows

  Scenario: Login with valid credentials
    Given I am on the Conduit login page
    When I enter "bench@example.com" as my email
    And I enter "BenchPass1!" as my password
    And I click the Sign in button
    Then I should be on the home feed

  Scenario: Publish a new article
    Given I am logged in to Conduit
    When I navigate to the new article page
    And I enter "Bench harness debut" as the article title
    And I enter "How we benchmark scaffolds" as the article description
    And I enter "Lorem ipsum dolor sit amet" as the article body
    And I click the Publish Article button
    Then I should be on the article detail page

  Scenario: Comment on an article
    Given I am on an article detail page
    When I enter "Great post" as my comment
    And I click the Post Comment button
    Then I should see "Great post" in the comments list
