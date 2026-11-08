<?php
  require_once 'config/config.php';
  $appName = $appPublicName ?? 'SPACE INVADERS';
  $appDescription = 'Play '.$appName.' online for free in your browser. Faithful remake of the legendary 1978 Taito arcade game with no download required.';
  $appPrefix = 'si';
  $appNoscript =
    '<h1>'.$appName.'</h1>'.
    '<p>Space Invaders is the 1978 arcade game by Tomohiro Nishikado (Taito) that started the golden age '.
    'of video arcades. Rows of alien invaders march across the screen and descend towards your laser cannon; '.
    'shoot them all before they land, hide behind the crumbling shields and hit the mystery ship for bonus points.</p>'.
    '<p>This is a faithful remake that runs directly in your web browser. '.
    'There is nothing to install and nothing to download — just open the page and play. '.
    'Please enable JavaScript to start the game.</p>'.
    '<p><a href="about">More about Space Invaders and this remake</a></p>';
  $appOpenGraph = [
    'image' => 'images/app-icon-512x512.png',
  ];
  $appJsonLd = [
    'genre' => 'Shoot \'em up',
    'isBasedOn' => [
      '@type' => 'VideoGame',
      'name' => 'Space Invaders',
      'author' => ['@type' => 'Person', 'name' => 'Tomohiro Nishikado'],
      'publisher' => [
        ['@type' => 'Organization', 'name' => 'Taito'],
      ],
      'datePublished' => '1978',
      'gamePlatform' => 'Arcade',
    ],
  ];
  require_once 'app/svision/php/main.php';
