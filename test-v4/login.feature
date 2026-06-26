Feature: Login data-driven
  Scenario Outline: Login as <username>
    Given I am on the login page
    When I login with username "<username>" and password "<password>"
    Then the URL should contain "<url_fragment>"

    Examples:
      | username | password | url_fragment |
      | inline_only | inline_pw | inline.html |
