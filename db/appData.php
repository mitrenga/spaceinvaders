<?php

class DataCommand {

  var $files = ['global', 'menu', 'sprites', 'font'];

  public function execute($postData) {
    $result = [];
    foreach ($this->files as $file) {
      $dataJSON = file_get_contents('data/'.$file.'.json');
      try {
        $result[$file] = json_decode($dataJSON);
      }
      catch (\JsonException $exception) {
        $result[$file] = ['error' => ['message' => $exception->getMessage()]];
      }
    }

    $mysqli = new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
    $data = $mysqli->query('SELECT `score` FROM `rg_si_hallOfFame` ORDER BY `score` DESC LIMIT 1');
    $mysqli->close();
    $result['hiScore'] = 0;
    if ($row = $data->fetch_object()) {
      $result['hiScore'] = $row->score;
    }

    return $result;
  } // execute

} // class DataCommand
