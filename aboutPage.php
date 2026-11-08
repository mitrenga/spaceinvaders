<?php

require_once 'app/svision/php/abstractAboutPage.php';

/**
 * The /about page: the story of the original Space Invaders and this remake.
 */
class AboutPage extends AbstractAboutPage {

  protected function aboutData() {
    return [
      'image' => 'images/cover.png',
      'sections' => [
        [
          'heading' => 'The original game (1978)',
          'html' =>
            '<p>Space Invaders was designed by Tomohiro Nishikado and released by Taito in 1978. It was one of '.
            'the first fixed shooters, the game that started the golden age of arcade video games and the '.
            'first to save a high score. Its black-and-white monitor with colored cellophane strips, the '.
            'accelerating march of the alien rack and the four-note heartbeat are icons of the era.</p>',
        ],
        [
          'heading' => 'This remake',
          'html' =>
            '<p>This is a faithful remake of the Taito arcade version: the original game logic (timing, '.
            'tables, movement) has been rewritten for the web browser, not emulated. It runs directly in '.
            'your browser — nothing to install, nothing to download. Keyboard, touch controls and gamepads '.
            'are supported.</p>'.$this->installNote(),
        ],
        [
          'heading' => 'Other games',
          'html' =>
            '<p>This remake is one of a growing collection of classic games from the 8-bit and 16-bit era '.
            '— ZX Spectrum, Commodore 64, arcade and more — rebuilt faithfully on the same library and '.
            'playable in your browser, free of charge. Browse the whole collection at '.
            '<a href="https://retrogames.free/" target="_blank" rel="noopener">retrogames.free</a>.</p>',
        ],
      ],
      'links' => [
        ['label' => 'Space Invaders on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/Space_Invaders'],
        ['label' => 'Tomohiro Nishikado on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/Tomohiro_Nishikado'],
        ['label' => 'Computer Archeology — Space Invaders disassembly', 'url' => 'https://computerarcheology.com/Arcade/SpaceInvaders/'],
      ],
      'footer' =>
        '<p>An unofficial fan remake. Space Invaders is a trademark of Taito Corporation; the original game '.
        'and its artwork belong to their authors. '.
        'The remake\'s source code is licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>.</p>',
    ];
  } // aboutData

} // AboutPage
