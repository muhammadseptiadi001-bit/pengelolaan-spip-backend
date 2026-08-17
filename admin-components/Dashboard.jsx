import React, { useEffect, useState } from 'react'
import { Box, H2, H4, Text, Loader } from '@adminjs/design-system'
import { ApiClient } from 'adminjs'

// Warna bar disesuaikan dengan makna labelnya — hijau = aman/layak, merah = bermasalah,
// kuning = perlu perhatian. Label yang tidak dikenal dapat warna biru sebagai default.
const WARNA_LABEL = {
  Layak: '#16a34a',
  'Tidak Layak': '#dc2626',
  'Sudah Lewat': '#dc2626',
  'Mendekati Jatuh Tempo': '#ca8a04',
  Aman: '#16a34a',
}

const BarChartSederhana = ({ judul, data }) => {
  const nilaiMaksimal = Math.max(1, ...data.map((item) => item.jumlah))

  return (
    <Box mb="xl">
      <H4 mb="default">{judul}</H4>
      {data.length === 0 && <Text color="grey60">Belum ada data.</Text>}
      {data.map((item) => (
        <Box key={item.label} display="flex" alignItems="center" mb="sm">
          <Box width="200px" mr="default">
            <Text>{item.label}</Text>
          </Box>
          <Box flex="1" bg="grey20" borderRadius="4px" overflow="hidden" height="20px">
            <Box
              height="100%"
              width={`${(item.jumlah / nilaiMaksimal) * 100}%`}
              style={{ backgroundColor: WARNA_LABEL[item.label] || '#2563eb', transition: 'width 0.3s' }}
            />
          </Box>
          <Box width="40px" ml="default" textAlign="right">
            <Text fontWeight="bold">{item.jumlah}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

const KartuRingkasan = ({ label, jumlah }) => (
  <Box
    bg="white"
    p="lg"
    borderRadius="8px"
    boxShadow="card"
    flex="1"
    minWidth="160px"
    mr="default"
    mb="default"
  >
    <Text fontSize="sm" color="grey60">{label}</Text>
    <H2 mt="sm">{jumlah}</H2>
  </Box>
)

const Dashboard = () => {
  const [data, setData] = useState(null)
  const [gagal, setGagal] = useState(false)

  useEffect(() => {
    const api = new ApiClient()
    api
      .getDashboard()
      .then((response) => setData(response.data))
      .catch((error) => {
        console.error('Gagal mengambil data dashboard:', error)
        setGagal(true)
      })
  }, [])

  if (gagal) {
    return (
      <Box p="xl">
        <Text color="red60">Gagal memuat data ringkasan. Coba muat ulang halaman.</Text>
      </Box>
    )
  }

  if (!data) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="300px">
        <Loader />
      </Box>
    )
  }

  const { ringkasan, statusKelayakan, statusWaktu } = data

  return (
    <Box p="xl">
      <H2 mb="lg">Ringkasan Data SPIP</H2>

      <Box display="flex" flexWrap="wrap" mb="xl">
        <KartuRingkasan label="Total Unit" jumlah={ringkasan.unit} />
        <KartuRingkasan label="Tenaga Teknik" jumlah={ringkasan.tenagaTeknik} />
        <KartuRingkasan label="Pemeliharaan" jumlah={ringkasan.pemeliharaan} />
        <KartuRingkasan label="Pemeriksaan Instalasi" jumlah={ringkasan.pemeriksaanInstalasi} />
        <KartuRingkasan label="Kajian Teknis" jumlah={ringkasan.kajianTeknis} />
        <KartuRingkasan label="User Terdaftar" jumlah={ringkasan.users} />
      </Box>

      <Box display="flex" flexWrap="wrap">
        <Box flex="1" minWidth="320px" mr="xl">
          <BarChartSederhana judul="Status Kelayakan Unit" data={statusKelayakan} />
        </Box>
        <Box flex="1" minWidth="320px">
          <BarChartSederhana judul="Status Waktu Uji Unit" data={statusWaktu} />
        </Box>
      </Box>
    </Box>
  )
}

export default Dashboard